import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseJson } from '../shared/json'
import type { ComposerDraft, DraftImage } from '../shared/types'
import { serial, writeAtomic } from './store'

/** The file in `dir` that holds one part of the draft under `key`. */
export const draftFile = (dir: string, key: string, part: keyof ComposerDraft): string =>
  join(dir, `${encodeURIComponent(key)}.${part}.json`)

const isImage = (i: unknown): i is DraftImage => {
  const x = i as Partial<DraftImage> | null
  return (
    typeof x?.id === 'string' &&
    typeof x.name === 'string' &&
    typeof x.size === 'number' &&
    typeof x.url === 'string'
  )
}

/** Composer drafts saved in `dir`, each part written on its own, one write at a time, keeping only the latest value queued per file. */
export function createDrafts(dir: string): {
  get(key: string): Promise<ComposerDraft | null>
  save(key: string, patch: Partial<ComposerDraft>): void
  flush(): Promise<void>
} {
  const write = serial()
  const queued = new Map<string, string | null>()
  const put = (file: string, text: string | null): void => {
    const waiting = queued.has(file)
    queued.set(file, text)
    if (waiting) return
    write(async () => {
      const latest = queued.get(file) ?? null
      queued.delete(file)
      await (latest === null ? fs.rm(file, { force: true }) : writeAtomic(file, latest))
    }).catch((err) => console.error('Sandtable could not save a draft', err))
  }
  const read = async (key: string, part: keyof ComposerDraft): Promise<unknown> =>
    parseJson(await fs.readFile(draftFile(dir, key, part), 'utf8').catch(() => ''))
  return {
    async get(key) {
      await write.flush()
      const text = await read(key, 'text')
      const images = await read(key, 'images')
      const draft = {
        text: typeof text === 'string' ? text : '',
        images: Array.isArray(images) ? images.filter(isImage) : []
      }
      return draft.text || draft.images.length ? draft : null
    },
    save(key, patch) {
      if (typeof key !== 'string') return
      if (typeof patch.text === 'string')
        put(draftFile(dir, key, 'text'), patch.text ? JSON.stringify(patch.text) : null)
      if (Array.isArray(patch.images))
        put(
          draftFile(dir, key, 'images'),
          patch.images.length ? JSON.stringify(patch.images.filter(isImage)) : null
        )
    },
    flush: write.flush
  }
}
