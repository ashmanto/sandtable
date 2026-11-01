import { act, render, renderHook, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ConversationChunk, ConversationEntry } from '../../../shared/types'
import { fakeSandtable } from '../test/fixtures'
import { useLiveConversation } from './useLiveConversation'

const facts = { todos: [], permissionMode: null, compactions: [] }
const say = (text: string): ConversationEntry => ({ kind: 'user', text })
const chunk = (from: number, ...texts: string[]): ConversationChunk => ({
  from,
  entries: texts.map(say),
  facts
})

function Shown({ id }: { id: string }): React.JSX.Element {
  const { entries, error } = useLiveConversation(id)
  return (
    <p>{`${id}:${error ?? entries?.map((e) => (e.kind === 'user' ? e.text : '?')).join(',') ?? 'none'}`}</p>
  )
}

function setup(): {
  api: ReturnType<typeof fakeSandtable>
  push: (id: string, c: ConversationChunk) => void
} {
  const api = fakeSandtable()
  const ref: { push: (id: string, c: ConversationChunk) => void } = { push: () => {} }
  vi.mocked(api.sessions.onConversation).mockImplementation((cb) => {
    ref.push = cb
    return () => {}
  })
  return { api, push: (id, c) => ref.push(id, c) }
}

it('splices a chunk at from', async () => {
  const { api, push } = setup()
  vi.mocked(api.sessions.watchConversation).mockResolvedValue(chunk(0, 'a', 'b'))
  render(<Shown id="s" />)
  expect(await screen.findByText('s:a,b')).toBeInTheDocument()
  act(() => push('s', chunk(1, 'c', 'd')))
  expect(screen.getByText('s:a,c,d')).toBeInTheDocument()
  act(() => push('s', chunk(0, 'z')))
  expect(screen.getByText('s:z')).toBeInTheDocument()
})

it('keeps where the entries start', async () => {
  const { api, push } = setup()
  vi.mocked(api.sessions.watchConversation).mockResolvedValue({ ...chunk(0, 'a'), start: 4 })
  const { result } = renderHook(() => useLiveConversation('s'))
  await vi.waitFor(() => expect(result.current.start).toBe(4))
  act(() => push('s', chunk(0, 'z')))
  expect(result.current.start).toBe(0)
})

it('unwatches on unmount', async () => {
  const { api } = setup()
  const { unmount } = render(<Shown id="s" />)
  await act(async () => {})
  expect(api.sessions.watchConversation).toHaveBeenCalledWith('s')
  unmount()
  expect(api.sessions.unwatchConversation).toHaveBeenCalledWith('s')
})

it("ignores other sessions' chunks", async () => {
  const { api, push } = setup()
  vi.mocked(api.sessions.watchConversation).mockResolvedValue(chunk(0, 'a'))
  render(<Shown id="s" />)
  expect(await screen.findByText('s:a')).toBeInTheDocument()
  act(() => push('other', chunk(1, 'x')))
  expect(screen.getByText('s:a')).toBeInTheDocument()
})

it('drops a chunk that arrives before the first watch resolves instead of truncating it', async () => {
  const { api, push } = setup()
  let load: (c: ConversationChunk) => void = () => {}
  vi.mocked(api.sessions.watchConversation).mockReturnValue(new Promise((r) => (load = r)))
  render(<Shown id="s" />)
  act(() => push('s', chunk(1, 'x')))
  await act(async () => load(chunk(0, 'a', 'b', 'c')))
  expect(screen.getByText('s:a,b,c')).toBeInTheDocument()
})

it('shows the error when the watch fails, and drops a stale watch after the id changes', async () => {
  const { api } = setup()
  vi.mocked(api.sessions.watchConversation).mockRejectedValueOnce(new Error('gone'))
  const { rerender } = render(<Shown id="s" />)
  expect(await screen.findByText('s:gone')).toBeInTheDocument()
  let late: (c: ConversationChunk) => void = () => {}
  vi.mocked(api.sessions.watchConversation).mockReturnValueOnce(new Promise((r) => (late = r)))
  rerender(<Shown id="t" />)
  vi.mocked(api.sessions.watchConversation).mockResolvedValueOnce(chunk(0, 'u'))
  rerender(<Shown id="v" />)
  await act(async () => late(chunk(0, 'stale')))
  expect(await screen.findByText('v:u')).toBeInTheDocument()
})

it('watches nothing without a session', () => {
  const { api } = setup()
  render(<Shown id="" />)
  expect(api.sessions.watchConversation).not.toHaveBeenCalled()
  expect(screen.getByText(':none')).toBeInTheDocument()
})

it('passes on a missing transcript', async () => {
  const { api } = setup()
  vi.mocked(api.sessions.watchConversation).mockResolvedValue({ ...chunk(0), missing: true })
  function Missing(): React.JSX.Element {
    return <p>{String(useLiveConversation('s').missing)}</p>
  }
  render(<Missing />)
  expect(await screen.findByText('true')).toBeInTheDocument()
})
