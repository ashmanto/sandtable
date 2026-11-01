import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { run } from '../env/tools'
import { MAX_CHARS } from '../../shared/findings'
import { parseJson } from '../../shared/json'
import type { DiffLine, FileDiff, RepoChanges } from '../../shared/types'
import { FOREIGN_GIT_DIR, gitOrThrow, NO_ORIGIN_HEAD, originHead, ownRepo } from './worktree'

/** The most diff lines a file shows; a larger file keeps only its counts. */
export const MAX_LINES = 1000

/** The most files a diff shows lines for; later files keep only their counts. */
export const MAX_FILES = 300

const TIMEOUT_MS = 30_000

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

function unquote(p: string): string {
  const bare = p.replace(/\t$/, '')
  if (!bare.startsWith('"')) return bare
  return (parseJson(bare) as string | undefined) ?? bare.slice(1, -1)
}

const cut = (text: string): string =>
  text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text

/** A `git diff` patch parser fed one line at a time, returning the files with their change, counts, and hunks. */
export function parser(): { line(line: string): void; done(): FileDiff[] } {
  const files: FileDiff[] = []
  let file: FileDiff | undefined
  let lines: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  let shown = 0
  const finish = (): void => {
    if (file && (shown > MAX_LINES || (files.length > MAX_FILES && shown > 0))) {
      file.hunks = []
      file.tooLarge = true
    }
  }
  const push = (l: DiffLine): void => {
    if (++shown <= MAX_LINES && files.length <= MAX_FILES) lines.push({ ...l, text: cut(l.text) })
  }
  return {
    line(line) {
      if (line.startsWith('diff --git ')) {
        finish()
        const both = line.slice('diff --git '.length)
        const path = unquote(both.slice((both.length + 1) / 2)).slice(2)
        file = { path, change: 'modified', added: 0, removed: 0, hunks: [] }
        files.push(file)
        shown = 0
        return
      }
      if (!file) return
      const hunk = HUNK.exec(line)
      if (hunk) {
        oldNo = Number(hunk[1])
        newNo = Number(hunk[2])
        lines = []
        file.hunks.push({ header: line, lines })
      } else if (file.hunks.length === 0) {
        if (line.startsWith('new file mode')) file.change = 'added'
        else if (line.startsWith('deleted file mode')) file.change = 'deleted'
        else if (line.startsWith('rename from ')) {
          file.change = 'renamed'
          file.oldPath = unquote(line.slice('rename from '.length))
        } else if (line.startsWith('rename to '))
          file.path = unquote(line.slice('rename to '.length))
        else if (line.startsWith('+++ ') && line !== '+++ /dev/null')
          file.path = unquote(line.slice('+++ '.length)).slice(2)
        else if (line.startsWith('Binary files ')) file.binary = true
      } else if (line.startsWith('+')) {
        file.added++
        push({ kind: 'added', text: line.slice(1), new: newNo++ })
      } else if (line.startsWith('-')) {
        file.removed++
        push({ kind: 'removed', text: line.slice(1), old: oldNo++ })
      } else if (line.startsWith(' ')) {
        push({ kind: 'context', text: line.slice(1), old: oldNo++, new: newNo++ })
      }
    },
    done() {
      finish()
      return files
    }
  }
}

const SAFE = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.quotePath=false',
  '-c',
  'diff.suppressBlankEmpty=false'
]

async function streamDiff(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<FileDiff[]> {
  const child = spawn('git', ['-C', cwd, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS)
  const p = parser()
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr = (stderr + d).slice(-4096)))
  const reader = createInterface({ input: child.stdout })
  reader.on('line', p.line)
  try {
    const [[code, signal]] = await Promise.all([once(child, 'close'), once(reader, 'close')])
    if (signal) throw new Error(`git diff got no answer within ${TIMEOUT_MS / 1000} seconds`)
    if (code !== 0)
      throw new Error(`git diff failed: ${stderr.split('\n').find((l) => l.trim()) ?? code}`)
    return p.done()
  } finally {
    clearTimeout(timer)
  }
}

/** A worktree's changes against its merge base with the default branch, untracked files included. */
export async function worktreeChanges(
  worktree: string,
  repoPaths: string[]
): Promise<Omit<RepoChanges, 'worktree'>> {
  if (!(await ownRepo(worktree, repoPaths))) throw new Error(FOREIGN_GIT_DIR)
  const base = await originHead(worktree)
  if (!base) throw new Error(NO_ORIGIN_HEAD)
  const mergeBase = (await gitOrThrow(worktree, 'merge-base', base, 'HEAD')).trim()
  const index = path.resolve(
    worktree,
    (await gitOrThrow(worktree, 'rev-parse', '--git-path', 'index')).trim()
  )
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandtable-index-'))
  try {
    const copy = path.join(dir, 'index')
    await fs.copyFile(index, copy)
    const { atime, mtime } = await fs.stat(index)
    await fs.utimes(copy, atime, mtime)
    const env = { ...process.env, GIT_INDEX_FILE: copy }
    const add = await run(
      'git',
      ['-C', worktree, ...SAFE, 'add', '--all', '--intent-to-add'],
      env,
      TIMEOUT_MS
    )
    if (add.code !== 0) throw new Error(`git add failed: ${add.stderr.trim() || add.code}`)
    const files = await streamDiff(
      worktree,
      [
        ...SAFE,
        `--attr-source=${mergeBase}`,
        'diff',
        '-M',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        mergeBase
      ],
      env
    )
    return { base, files }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
