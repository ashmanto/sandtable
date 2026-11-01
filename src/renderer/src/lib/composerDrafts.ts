import { useEffect, useState } from 'react'
import type { ComposerDraft, DraftImage } from '../../../shared/types'

const EMPTY: ComposerDraft = { text: '', images: [] }

/** The composer drafts this run has read or changed, by key; the main process keeps them across restarts. */
export const composerDrafts = new Map<string, ComposerDraft>()

type Update<T> = T | ((prev: T) => T)

/** The unsent draft saved under `key`, and setters that change and save it even after the composer goes away. */
export function useComposerDraft(key: string): ComposerDraft & {
  setText(text: Update<string>): void
  setImages(images: Update<DraftImage[]>): void
} {
  const [shown, setShown] = useState(() => ({ key, draft: composerDrafts.get(key) ?? EMPTY }))
  if (shown.key !== key) setShown({ key, draft: composerDrafts.get(key) ?? EMPTY })

  useEffect(() => {
    if (composerDrafts.has(key)) return
    window.sandtable.app.draft(key).then(
      (draft) => {
        if (!draft || composerDrafts.has(key)) return
        composerDrafts.set(key, draft)
        setShown((s) => (s.key === key ? { key, draft } : s))
      },
      () => {}
    )
  }, [key])

  const update = <K extends keyof ComposerDraft>(
    part: K,
    value: Update<ComposerDraft[K]>
  ): void => {
    const prev = composerDrafts.get(key) ?? EMPTY
    const next = { ...prev, [part]: typeof value === 'function' ? value(prev[part]) : value }
    composerDrafts.set(key, next)
    window.sandtable.app.saveDraft(key, { [part]: next[part] })
    setShown((s) => (s.key === key ? { key, draft: next } : s))
  }
  return {
    ...shown.draft,
    setText: (text) => update('text', text),
    setImages: (images) => update('images', images)
  }
}
