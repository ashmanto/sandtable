/** Prefix of the error a start throws when a worktree's setup command fails. */
export const SETUP_FAILED = 'Setup failed'

/** Prefix of the error a start throws when the person cancels a worktree's setup. */
export const SETUP_CANCELLED = 'Setup cancelled'

/** Why a worktree setup copy path isn't a path inside the repo, or null when it is. */
export function copyPathProblem(p: string): string | null {
  if (p.includes('\0')) return 'remove the NUL byte'
  if (!p.trim()) return 'it is empty'
  if (p.trim() !== p) return 'remove the spaces around it'
  if (p.startsWith('/') || p.split('/').includes('..')) return 'use a path inside the repo'
  return null
}

/** Lockfiles a setup suggestion reads, the command each names, and the folder that command builds. */
export const LOCKFILES: { file: string; command: string; builds?: string }[] = [
  { file: 'package-lock.json', command: 'npm install', builds: 'node_modules' },
  { file: 'pnpm-lock.yaml', command: 'pnpm install', builds: 'node_modules' },
  { file: 'yarn.lock', command: 'yarn install', builds: 'node_modules' },
  { file: 'uv.lock', command: 'uv sync', builds: '.venv' },
  { file: 'Gemfile.lock', command: 'bundle install' }
]
