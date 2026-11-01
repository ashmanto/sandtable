import type { IPty, spawn as ptySpawn } from 'node-pty'
import { describe, expect, it, vi } from 'vitest'
import type { SessionRecord } from '../shared/types'
import { createTerminals } from './terminal'

type FakePty = IPty & { exit: () => void }

const setup = (): { ptys: FakePty[]; terminals: ReturnType<typeof createTerminals> } => {
  const ptys: FakePty[] = []
  const spawn = vi.fn(() => {
    let onExit = (): void => undefined
    const pty = {
      onData: vi.fn(),
      onExit: (cb: () => void) => void (onExit = cb),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      exit: () => onExit()
    } as unknown as FakePty
    ptys.push(pty)
    return pty
  }) as unknown as typeof ptySpawn
  const terminals = createTerminals({
    tmuxBin: 'tmux',
    session: (id) => ({ id, tmuxName: `t-${id}` }) as SessionRecord,
    send: () => undefined,
    spawn
  })
  return { ptys, terminals }
}

describe('createTerminals', () => {
  it('closes the earlier pty before opening the session again', () => {
    const { ptys, terminals } = setup()
    terminals.open('s1', 80, 24)
    terminals.open('s1', 80, 24)
    expect(ptys[0].kill).toHaveBeenCalled()
    expect(ptys[1].kill).not.toHaveBeenCalled()
  })

  it('keeps the current pty when a replaced one exits', () => {
    const { ptys, terminals } = setup()
    terminals.open('s1', 80, 24)
    terminals.open('s1', 80, 24)
    ptys[0].exit()
    terminals.write('s1', 'a')
    expect(ptys[1].write).toHaveBeenCalledWith('a')
  })

  it('kills every pty on closeAll', () => {
    const { ptys, terminals } = setup()
    terminals.open('s1', 80, 24)
    terminals.open('s2', 80, 24)
    terminals.closeAll()
    expect(ptys.map((p) => vi.mocked(p.kill).mock.calls.length)).toEqual([1, 1])
    terminals.write('s1', 'a')
    expect(ptys[0].write).not.toHaveBeenCalled()
  })
})
