import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cliDir, createCliServer, type CliHandler } from './cli'

type Ran = { code: number; stdout: string; stderr: string }
const servers: { closeAll(): Promise<void> }[] = []
const make = (handle: CliHandler): { dir: string; server: ReturnType<typeof createCliServer> } => {
  const dir = mkdtempSync(join(tmpdir(), 'st-cli-'))
  const server = createCliServer(dir, handle)
  servers.push(server)
  return { dir, server }
}
const run = (dir: string, socket: string, args: string[]): Promise<Ran> =>
  new Promise((resolve) =>
    execFile(
      'sh',
      [join(dir, 'sandtable'), ...args],
      { env: { ...process.env, SANDTABLE_SOCKET: socket } },
      (err, stdout, stderr) =>
        resolve({
          code: err ? ((err as { code?: number }).code ?? 1) : 0,
          stdout,
          stderr
        })
    )
  )

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.closeAll()))
})

describe('sandtable CLI server', () => {
  it("serves the caller's session ID", async () => {
    const handle = vi.fn<CliHandler>(async () => ({ code: 0, text: 'Working' }))
    const { dir, server } = make(handle)
    const socket = await server.open('s1')
    const ran = await run(dir, socket, ['status', '#12'])
    expect(handle).toHaveBeenCalledWith('s1', 'status', '#12', undefined, expect.any(AbortSignal))
    expect(ran).toMatchObject({ code: 0, stdout: 'Working\n' })
  })

  it('exits 1 with the reason on stderr when refused', async () => {
    const { dir, server } = make(async () => ({ code: 1, text: 'Not ready' }))
    const ran = await run(dir, await server.open('s1'), ['start', '#12'])
    expect(ran).toMatchObject({ code: 1, stdout: '' })
    expect(ran.stderr).toContain('Not ready')
  })

  it('exits 3 when wait times out', async () => {
    const handle = vi.fn<CliHandler>(async () => ({ code: 3, text: 'Still running' }))
    const { dir, server } = make(handle)
    const ran = await run(dir, await server.open('s1'), ['wait', '#12', '--timeout', '5'])
    expect(handle).toHaveBeenCalledWith('s1', 'wait', '#12', 5, expect.any(AbortSignal))
    expect(ran.code).toBe(3)
    expect(ran.stderr).toContain('Still running')
  })

  it('exits 2 on an unknown command', async () => {
    const handle = vi.fn<CliHandler>(async () => ({ code: 0, text: '' }))
    const { dir, server } = make(handle)
    const socket = await server.open('s1')
    const ran = await run(dir, socket, ['nope', '#12'])
    expect(ran.code).toBe(2)
    expect(ran.stderr).toContain('Usage')
    expect((await run(dir, socket, ['start'])).code).toBe(2)
    expect(handle).not.toHaveBeenCalled()
  })

  it('exits 2 on a timeout that is not a positive integer', async () => {
    const handle = vi.fn<CliHandler>(async () => ({ code: 0, text: '' }))
    const { dir, server } = make(handle)
    const socket = await server.open('s1')
    for (const bad of ['0', '00', '-5', '1.5', 'x']) {
      const ran = await run(dir, socket, ['wait', '#12', '--timeout', bad])
      expect(ran.code).toBe(2)
      expect(ran.stderr).toContain('Usage')
    }
    expect(handle).not.toHaveBeenCalled()
  })

  it('signals the handler when the caller hangs up', async () => {
    let signal: AbortSignal | undefined
    const { dir, server } = make(
      (_c, _cmd, _t, _s, sig) =>
        new Promise(() => {
          signal = sig
        })
    )
    const socket = await server.open('s1')
    const child = spawn('sh', [join(dir, 'sandtable'), 'wait', '#12'], {
      env: { ...process.env, SANDTABLE_SOCKET: socket },
      detached: true,
      stdio: 'ignore'
    })
    await vi.waitFor(() => expect(signal).toBeDefined())
    process.kill(-child.pid!)
    await vi.waitFor(() => expect(signal!.aborted).toBe(true))
  })

  it("refuses to bind over another session's socket that shares its name", async () => {
    const { server } = make(async () => ({ code: 0, text: '' }))
    const first = await server.open('0123456789ab-one')
    await expect(server.open('0123456789ab-two')).rejects.toThrow()
    expect(existsSync(first)).toBe(true)
  })

  it('reopens over a stale socket file', async () => {
    const { dir, server } = make(async () => ({ code: 0, text: 'ok' }))
    const socket = await server.open('s1')
    await server.close('s1')
    writeFileSync(socket, '')
    expect(await server.open('s1')).toBe(socket)
    expect((await run(dir, socket, ['info', '#1'])).code).toBe(0)
  })

  it('opens once per session', async () => {
    const { server } = make(async () => ({ code: 0, text: 'ok' }))
    expect(await server.open('s1')).toBe(await server.open('s1'))
  })

  it('keeps a reopened socket when an earlier close is still pending', async () => {
    const { server } = make(async () => ({ code: 0, text: 'ok' }))
    for (let i = 0; i < 20; i++) {
      await server.open('s1')
      void server.close('s1')
      const socket = await server.open('s1')
      await new Promise((r) => setTimeout(r, 5))
      expect(existsSync(socket)).toBe(true)
    }
  })

  it('removes the socket file on close', async () => {
    const { server } = make(async () => ({ code: 0, text: 'ok' }))
    const socket = await server.open('s1')
    await server.close('s1')
    expect(existsSync(socket)).toBe(false)
  })
})

describe('cliDir', () => {
  it('sits under the caches folder, keyed by the data folder', () => {
    const dir = cliDir('/data', '/home/me')
    expect(dir).toMatch(/^\/home\/me\/Library\/Caches\/Sandtable\/cli-[0-9a-f]{8}$/)
    expect(cliDir('/other', '/home/me')).not.toBe(dir)
  })
})
