import type { FileHandle } from 'node:fs/promises'

const CHUNK = 1 << 20

/** Reads [start, size) of a file in chunks, passes each chunk's complete lines and the offset after them to onLines, and returns the offset after the last complete line. */
export async function readAppended(
  handle: FileHandle,
  start: number,
  size: number,
  onLines: (text: string, end: number) => void
): Promise<number> {
  const buffer = Buffer.alloc(Math.max(0, Math.min(CHUNK, size - start)))
  let partial = Buffer.alloc(0)
  let pos = start
  while (pos < size) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - pos), pos)
    if (!bytesRead) break
    pos += bytesRead
    const data = Buffer.concat([partial, buffer.subarray(0, bytesRead)])
    const end = data.lastIndexOf(10) + 1
    partial = data.subarray(end)
    if (end) onLines(data.subarray(0, end).toString('utf8'), pos - partial.length)
  }
  return pos - partial.length
}
