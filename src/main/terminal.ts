import type { IPty, spawn as ptySpawn } from 'node-pty'
import type { SessionRecord } from '../shared/types'
import { tmuxBaseArgs } from './sessions/tmux'

/** Live tmux clients, one per open session terminal. */
export type Terminals = {
  open(sessionId: string, cols: number, rows: number): void
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  close(sessionId: string): void
  closeAll(): void
}

/** Attaches node-pty tmux clients to sessions; closing one detaches it and leaves the session running. */
export function createTerminals(deps: {
  tmuxBin: string
  session: (id: string) => SessionRecord | undefined
  send: (sessionId: string, data: string) => void
  spawn: typeof ptySpawn
}): Terminals {
  const ptys = new Map<string, IPty>()

  const close = (sessionId: string): void => {
    ptys.get(sessionId)?.kill()
    ptys.delete(sessionId)
  }

  return {
    open(sessionId: string, cols: number, rows: number): void {
      close(sessionId)
      const s = deps.session(sessionId)
      if (!s) throw new Error('Unknown session')
      const pty = deps.spawn(
        deps.tmuxBin,
        [...tmuxBaseArgs(), '-u', 'attach-session', '-t', `=${s.tmuxName}`],
        {
          name: 'xterm-256color',
          cols,
          rows,
          env: { ...process.env, TERM: 'xterm-256color' }
        }
      )
      pty.onData((data) => deps.send(sessionId, data))
      pty.onExit(() => {
        if (ptys.get(sessionId) === pty) ptys.delete(sessionId)
      })
      ptys.set(sessionId, pty)
    },
    write: (sessionId: string, data: string): void => ptys.get(sessionId)?.write(data),
    resize: (sessionId: string, cols: number, rows: number): void =>
      ptys.get(sessionId)?.resize(cols, rows),
    close,
    closeAll: (): void => [...ptys.keys()].forEach(close)
  }
}
