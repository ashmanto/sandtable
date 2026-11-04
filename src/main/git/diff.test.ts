import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_CHARS } from '../../shared/findings'
import type { FileDiff } from '../../shared/types'
import { MAX_FILES, MAX_LINES, parser, worktreeChanges } from './diff'
import { ownGitDir } from './worktree'

const parseDiff = (patch: string): FileDiff[] => {
  const p = parser()
  for (const line of patch.split(/\r?\n/)) p.line(line)
  return p.done()
}

describe('parser', () => {
  it('reads a modified file with line numbers and counts', () => {
    const [f] = parseDiff(
      [
        'diff --git a/src/a.ts b/src/a.ts',
        'index 1111111..2222222 100644',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -3,3 +3,4 @@ function a() {',
        ' keep',
        '-old',
        '+new',
        '+more',
        ' tail',
        '\\ No newline at end of file',
        ''
      ].join('\n')
    )
    expect(f).toMatchObject({ path: 'src/a.ts', change: 'modified', added: 2, removed: 1 })
    expect(f.hunks).toEqual([
      {
        header: '@@ -3,3 +3,4 @@ function a() {',
        lines: [
          { kind: 'context', text: 'keep', old: 3, new: 3 },
          { kind: 'removed', text: 'old', old: 4 },
          { kind: 'added', text: 'new', new: 4 },
          { kind: 'added', text: 'more', new: 5 },
          { kind: 'context', text: 'tail', old: 5, new: 6 }
        ]
      }
    ])
  })

  it('reads added, deleted, renamed, and binary files', () => {
    const files = parseDiff(
      [
        'diff --git a/new.txt b/new.txt',
        'new file mode 100644',
        'index 0000000..1111111',
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1 @@',
        '+hi',
        'diff --git a/gone.txt b/gone.txt',
        'deleted file mode 100644',
        'index 1111111..0000000',
        '--- a/gone.txt',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-bye',
        'diff --git a/old name.md b/docs/new name.md',
        'similarity index 90%',
        'rename from old name.md',
        'rename to docs/new name.md',
        'diff --git a/logo.png b/logo.png',
        'new file mode 100644',
        'index 0000000..1111111',
        'Binary files /dev/null and b/logo.png differ'
      ].join('\n')
    )
    expect(files.map((f) => [f.path, f.change, f.added, f.removed])).toEqual([
      ['new.txt', 'added', 1, 0],
      ['gone.txt', 'deleted', 0, 1],
      ['docs/new name.md', 'renamed', 0, 0],
      ['logo.png', 'added', 0, 0]
    ])
    expect(files[2].oldPath).toBe('old name.md')
    expect(files[3].binary).toBe(true)
  })

  it('keeps the counts but drops the lines of a file over the cap', () => {
    const body = Array.from({ length: MAX_LINES + 1 }, (_, i) => `+line ${i}`)
    const [f] = parseDiff(
      ['diff --git a/big b/big', '--- a/big', '+++ b/big', '@@ -0,0 +1,1001 @@', ...body].join('\n')
    )
    expect(f).toMatchObject({ added: MAX_LINES + 1, tooLarge: true, hunks: [] })
  })

  it('keeps a lineless change past the file cap as it is', () => {
    const added = Array.from({ length: MAX_FILES }, (_, i) => [
      `diff --git a/f${i} b/f${i}`,
      'new file mode 100644',
      '@@ -0,0 +1 @@',
      '+x'
    ]).flat()
    const files = parseDiff(
      [
        ...added,
        'diff --git a/old b/new',
        'similarity index 100%',
        'rename from old',
        'rename to new'
      ].join('\n')
    )
    expect(files[MAX_FILES - 1].tooLarge).toBeUndefined()
    expect(files[MAX_FILES]).toEqual({
      path: 'new',
      oldPath: 'old',
      change: 'renamed',
      added: 0,
      removed: 0,
      hunks: []
    })
  })

  it('cuts a long line to the character cap', () => {
    const [f] = parseDiff(
      ['diff --git a/min.js b/min.js', '@@ -0,0 +1 @@', '+' + 'x'.repeat(MAX_CHARS + 5)].join('\n')
    )
    expect(f.hunks[0].lines[0].text).toBe('x'.repeat(MAX_CHARS) + '…')
  })

  it('decodes quoted paths', () => {
    const files = parseDiff(
      [
        'diff --git "a/quo\\"te.txt" "b/quo\\"te.txt"',
        'new file mode 100644',
        'Binary files /dev/null and "b/quo\\"te.txt" differ',
        'diff --git "a/ta\\tb.txt" "b/ta\\tb.txt"',
        '--- /dev/null',
        '+++ "b/ta\\tb.txt"',
        '@@ -0,0 +1 @@',
        '+x'
      ].join('\n')
    )
    expect(files.map((f) => f.path)).toEqual(['quo"te.txt', 'ta\tb.txt'])
  })

  it('returns no files for an empty diff', () => {
    expect(parseDiff('')).toEqual([])
  })
})

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })

describe('worktreeChanges', () => {
  let root: string
  let wt: string
  let repo: string

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sandtable-diff-')))
    repo = path.join(root, 'repo')
    await fs.mkdir(repo)
    git(repo, 'init', '-b', 'main')
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'config', 'user.email', 'test@example.com')
    await fs.writeFile(path.join(repo, 'a.txt'), 'a\n')
    await fs.writeFile(path.join(repo, '.gitignore'), 'ignored.txt\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'init')
    git(root, 'clone', '--bare', repo, path.join(root, 'origin.git'))
    git(repo, 'remote', 'add', 'origin', path.join(root, 'origin.git'))
    git(repo, 'fetch', 'origin')
    git(repo, 'remote', 'set-head', 'origin', 'main')
    wt = path.join(root, 'wt')
    git(repo, 'worktree', 'add', '-b', '1-thing', wt, 'origin/main')
    git(wt, 'config', 'user.name', 'Test')
    git(wt, 'config', 'user.email', 'test@example.com')
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it("finds a linked worktree's git folder in the project's repo, and nothing for another", async () => {
    expect(await ownGitDir(wt, [repo])).toBe(path.join(repo, '.git', 'worktrees', 'wt'))
    expect(await ownGitDir(wt, [])).toBeUndefined()
    expect(await ownGitDir(repo, [repo])).toBeUndefined()
  })

  it("reads a CRLF file's lines without their carriage return", async () => {
    await fs.writeFile(path.join(wt, 'crlf.txt'), 'a\r\n')
    git(wt, 'add', 'crlf.txt')
    git(wt, 'commit', '-m', 'crlf')
    await fs.writeFile(path.join(wt, 'crlf.txt'), 'a\r\nb\r\n')
    const { files } = await worktreeChanges(wt, [repo])
    expect(files[0].hunks.flatMap((h) => h.lines.map((l) => l.text))).toEqual(['a', 'b'])
  })

  it('reports no files for a clean worktree', async () => {
    expect(await worktreeChanges(wt, [repo])).toEqual({ base: 'origin/main', files: [] })
  })

  it('shows commits, uncommitted edits, and untracked files, and leaves the index alone', async () => {
    await fs.writeFile(path.join(wt, 'committed.txt'), 'c\n')
    git(wt, 'add', 'committed.txt')
    git(wt, 'commit', '-m', 'c')
    await fs.writeFile(path.join(wt, 'a.txt'), 'a\nb\n')
    await fs.writeFile(path.join(wt, 'untracked.txt'), 'u\n')
    await fs.writeFile(path.join(wt, 'ignored.txt'), 'i\n')
    const before = git(wt, 'status', '--porcelain')

    const { files } = await worktreeChanges(wt, [repo])

    expect(files.map((f) => [f.path, f.change, f.added, f.removed])).toEqual([
      ['a.txt', 'modified', 1, 0],
      ['committed.txt', 'added', 1, 0],
      ['untracked.txt', 'added', 1, 0]
    ])
    expect(git(wt, 'status', '--porcelain')).toBe(before)
  })

  it("doesn't store untracked files in the repo's objects", async () => {
    await fs.writeFile(path.join(wt, 'dump.log'), 'unique content 8c1f\n')
    await worktreeChanges(wt, [repo])
    const blob = execFileSync('git', ['hash-object', '--stdin'], {
      cwd: wt,
      input: 'unique content 8c1f\n',
      encoding: 'utf8'
    }).trim()
    expect(() => git(wt, 'cat-file', '-e', blob)).toThrow()
  })

  it('reads the same under diff.noprefix and diff.suppressBlankEmpty', async () => {
    await fs.writeFile(path.join(wt, 'a.txt'), 'a\n\nb\nc\n')
    git(wt, 'commit', '-am', 'blank')
    git(wt, 'push', 'origin', 'HEAD:main')
    git(wt, 'fetch', 'origin')
    git(wt, 'config', 'diff.noprefix', 'true')
    git(wt, 'config', 'diff.suppressBlankEmpty', 'true')
    await fs.writeFile(path.join(wt, 'a.txt'), 'a\n\nb\nC\n')
    const [f] = (await worktreeChanges(wt, [repo])).files
    expect(f.path).toBe('a.txt')
    expect(f.hunks[0].lines.find((l) => l.kind === 'added')).toEqual({
      kind: 'added',
      text: 'C',
      new: 4
    })
  })

  it('sees a same-size edit made in the second of the last index write', async () => {
    git(wt, 'config', 'core.trustctime', 'false')
    const file = path.join(wt, 'a.txt')
    const t = Math.floor(Date.now() / 1000) - 100
    await fs.utimes(file, t, t)
    git(wt, 'update-index', '--refresh')
    await fs.writeFile(file, 'b\n')
    await fs.utimes(file, t, t)
    await fs.utimes(path.resolve(wt, git(wt, 'rev-parse', '--git-path', 'index').trim()), t, t)
    expect((await worktreeChanges(wt, [repo])).files.map((f) => f.path)).toEqual(['a.txt'])
  })

  it("ignores the branch's own .gitattributes for how files show", async () => {
    await fs.writeFile(path.join(wt, '.gitattributes'), 'a.txt binary\n')
    await fs.writeFile(path.join(wt, 'a.txt'), 'a\nb\n')
    const a = (await worktreeChanges(wt, [repo])).files.find((f) => f.path === 'a.txt')
    expect(a).toMatchObject({ added: 1, removed: 0 })
    expect(a?.binary).toBeUndefined()
  })

  it('shows a file over the line cap with its counts only', async () => {
    const big = Array.from({ length: MAX_LINES * 50 }, (_, i) => `line ${i}`).join('\n') + '\n'
    await fs.writeFile(path.join(wt, 'big.txt'), big)
    const [f] = (await worktreeChanges(wt, [repo])).files
    expect(f).toMatchObject({ path: 'big.txt', added: MAX_LINES * 50, tooLarge: true, hunks: [] })
  })

  it('shows files past the file cap with their counts only', async () => {
    for (let i = 0; i <= MAX_FILES; i++)
      await fs.writeFile(path.join(wt, `f${String(i).padStart(3, '0')}.txt`), 'x\n')
    const { files } = await worktreeChanges(wt, [repo])
    expect(files).toHaveLength(MAX_FILES + 1)
    expect(files[MAX_FILES - 1].tooLarge).toBeUndefined()
    expect(files[MAX_FILES]).toMatchObject({
      path: 'f300.txt',
      added: 1,
      tooLarge: true,
      hunks: []
    })
  })

  it("refuses a worktree whose .git points at another repo's worktree entry", async () => {
    const evil = path.join(root, 'evil')
    const marker = path.join(root, 'ran')
    git(root, 'init', evil)
    git(evil, 'config', 'filter.x.clean', `touch ${marker}`)
    await fs.cp(path.join(repo, '.git/worktrees/wt'), path.join(evil, '.git/worktrees/wt'), {
      recursive: true
    })
    await fs.writeFile(path.join(wt, '.git'), `gitdir: ${path.join(evil, '.git/worktrees/wt')}\n`)
    await fs.writeFile(path.join(wt, '.gitattributes'), '* filter=x\n')
    await expect(worktreeChanges(wt, [repo])).rejects.toThrow(/points outside the project's repo/)
    await expect(fs.stat(marker)).rejects.toThrow()
  })

  it('reports a missing origin/HEAD without asking the remote', async () => {
    git(wt, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD')
    await expect(worktreeChanges(wt, [repo])).rejects.toThrow(/no origin\/HEAD/)
    expect(() => git(wt, 'symbolic-ref', 'refs/remotes/origin/HEAD')).toThrow()
  })

  it('leaves commits on the default branch since the start out of the diff', async () => {
    const other = path.join(root, 'other')
    git(root, 'clone', path.join(root, 'origin.git'), other)
    git(other, 'config', 'user.name', 'Test')
    git(other, 'config', 'user.email', 'test@example.com')
    await fs.writeFile(path.join(other, 'upstream.txt'), 'u\n')
    git(other, 'add', '.')
    git(other, 'commit', '-m', 'upstream')
    git(other, 'push', 'origin', 'main')
    git(wt, 'fetch', 'origin')
    expect((await worktreeChanges(wt, [repo])).files).toEqual([])
  })
})
