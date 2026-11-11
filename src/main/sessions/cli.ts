import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { messageOf } from '../../shared/errors'

/** The `sh` script on a ticket session's `PATH` that sends its command to the session's socket. */
export const CLI_SCRIPT = `#!/bin/sh
usage() { echo "Usage: sandtable start|status|wait|summary|info <ticket> [--timeout <seconds>]" >&2; exit 2; }
cmd=$1
case "$cmd" in start|status|wait|summary|info) ;; *) usage ;; esac
shift
ticket=
timeout=
while [ $# -gt 0 ]; do
  case "$1" in
    --timeout) [ "$cmd" = wait ] && [ -n "$2" ] || usage; timeout=$2; shift 2 ;;
    -*) usage ;;
    *) [ -z "$ticket" ] || usage; ticket=$1; shift ;;
  esac
done
[ -n "$ticket" ] || usage
case "$timeout" in *[!0-9]*) usage ;; esac
[ -z "$timeout" ] || [ "$timeout" -gt 0 ] || usage
[ -n "$SANDTABLE_SOCKET" ] || { echo "sandtable: SANDTABLE_SOCKET isn't set" >&2; exit 1; }
max=900
[ "$cmd" = start ] && max=1800
[ "$cmd" = wait ] && max=$(( \${timeout:-540} + 60 ))
set -- --data-urlencode "ticket=$ticket"
[ -n "$timeout" ] && set -- "$@" --data-urlencode "timeout=$timeout"
body=$(mktemp) || exit 1
trap 'rm -f "$body"' EXIT
status=$(curl -sS -G --unix-socket "$SANDTABLE_SOCKET" --max-time "$max" -o "$body" -w '%{http_code}' "$@" "http://sandtable/$cmd") || exit 1
case "$status" in
  200) cat "$body"; exit 0 ;;
  408) cat "$body" >&2; exit 3 ;;
  *) cat "$body" >&2; exit 1 ;;
esac
`

/** The folder that holds the `sandtable` script and the session sockets for one data folder. */
export const cliDir = (dataDir: string, home = homedir()): string =>
  join(
    home,
    'Library',
    'Caches',
    'Sandtable',
    `cli-${createHash('sha256').update(dataDir).digest('hex').slice(0, 8)}`
  )

/** A command the `sandtable` script sends. */
type CliCommand = 'start' | 'status' | 'wait' | 'summary' | 'info'

/** A command's result: 0 is done, 1 is refused or failed, 3 is a `wait` that timed out. */
type CliReply = { code: 0 | 1 | 3; text: string }

/** Runs a command for the session that called it. */
export type CliHandler = (
  callerId: string,
  command: CliCommand,
  ticket: string,
  timeoutSec?: number,
  signal?: AbortSignal
) => Promise<CliReply>

const COMMANDS: readonly string[] = ['start', 'status', 'wait', 'summary', 'info']
const STATUS = { 0: 200, 1: 409, 3: 408 } as const

/** A Unix socket server per session, each answering `GET /<command>?ticket=...` with the handler's reply. */
export function createCliServer(
  dir: string,
  handle: CliHandler
): {
  open(sessionId: string): Promise<string>
  close(sessionId: string): Promise<void>
  closeAll(): Promise<void>
} {
  const servers = new Map<string, { socket: string; server: Server }>()

  const answer = async (
    sessionId: string,
    req: IncomingMessage,
    signal: AbortSignal
  ): Promise<CliReply> => {
    const url = new URL(req.url ?? '/', 'http://sandtable')
    const command = url.pathname.slice(1)
    const ticket = url.searchParams.get('ticket')
    const timeout = Number(url.searchParams.get('timeout'))
    if (req.method !== 'GET' || !COMMANDS.includes(command) || !ticket)
      return { code: 1, text: 'Not a command' }
    return handle(
      sessionId,
      command as CliCommand,
      ticket,
      timeout > 0 ? timeout : undefined,
      signal
    ).catch((err: unknown) => ({ code: 1, text: messageOf(err) }))
  }

  const serve = (sessionId: string): Server =>
    createServer((req, res) => {
      const hungUp = new AbortController()
      res.on('close', () => hungUp.abort())
      void answer(sessionId, req, hungUp.signal).then((reply) => {
        res.writeHead(STATUS[reply.code], { 'content-type': 'text/plain; charset=utf-8' })
        res.end(reply.text.endsWith('\n') ? reply.text : `${reply.text}\n`)
      })
    })

  const closing = new Map<string, Promise<void>>()
  const close = (sessionId: string): Promise<void> => {
    const open = servers.get(sessionId)
    if (!open) return closing.get(sessionId) ?? Promise.resolve()
    servers.delete(sessionId)
    const done = new Promise<void>((resolve) => {
      open.server.close(() => resolve())
      open.server.closeAllConnections()
    })
      .then(() => unlink(open.socket).catch(() => undefined))
      .finally(() => closing.delete(sessionId))
    closing.set(sessionId, done)
    return done
  }

  const opening = new Map<string, Promise<string>>()
  const openNow = async (sessionId: string): Promise<string> => {
    await closing.get(sessionId)
    const existing = servers.get(sessionId)
    if (existing) return existing.socket
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700)
    const script = join(dir, 'sandtable')
    const temp = `${script}.${randomUUID()}`
    await writeFile(temp, CLI_SCRIPT, { mode: 0o755 })
    await rename(temp, script)
    const socket = join(dir, `${sessionId.slice(0, 12)}.sock`)
    if ([...servers.values()].some((s) => s.socket === socket))
      throw new Error(`Another session uses ${socket}`)
    await unlink(socket).catch(() => undefined)
    const server = serve(sessionId)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socket, resolve)
    })
    servers.set(sessionId, { socket, server })
    return socket
  }

  return {
    open(sessionId) {
      const pending = opening.get(sessionId)
      if (pending) return pending
      const done = openNow(sessionId).finally(() => opening.delete(sessionId))
      opening.set(sessionId, done)
      return done
    },
    close,
    closeAll: () => Promise.all([...servers.keys()].map(close)).then(() => undefined)
  }
}
