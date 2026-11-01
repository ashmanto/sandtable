import type { Emoji, MessagesDataset, SkinTone } from 'emojibase'
import type { EmojiData } from 'frimousse'

type Tones = EmojiData['skinTones']

const TONES: (keyof Tones)[] = ['light', 'medium-light', 'medium', 'medium-dark', 'dark']
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** Emojibase's English data in frimousse's shape, mapped as frimousse's resolver does, capped at Emoji 17. */
export function emojiData(emojis: Emoji[], messages: MessagesDataset): EmojiData {
  return {
    locale: 'en',
    categories: messages.groups
      .filter((g) => g.key !== 'component')
      .map((g) => ({ index: g.order, label: capitalize(g.message) })),
    skinTones: Object.fromEntries(
      messages.skinTones.map((t) => [t.key, capitalize(t.message)])
    ) as Tones,
    emojis: emojis
      // shortcut: macOS draws Emoji 17 at most, raise this when it ships Emoji 18
      .filter((e): e is Emoji & { group: number } => e.group !== undefined && e.version <= 17)
      .map((e) => {
        const toned = e.skins?.filter(
          (s): s is Emoji & { tone: SkinTone } => typeof s.tone === 'number'
        )
        const aliases = e.skins?.filter((s) => Array.isArray(s.tone)).map((s) => s.emoji)
        return {
          emoji: e.emoji,
          category: e.group,
          version: e.version,
          label: capitalize(e.label),
          tags: e.tags ?? [],
          skins:
            toned && (Object.fromEntries(toned.map((s) => [TONES[s.tone - 1], s.emoji])) as Tones),
          aliases: aliases?.length ? aliases : undefined
        }
      })
  }
}

/** Loads the emoji data from the app bundle, in a lazy chunk, instead of frimousse's CDN. */
export async function resolveEmojiData(): Promise<EmojiData> {
  const [emojis, messages] = await Promise.all([
    import('emojibase-data/en/data.json'),
    import('emojibase-data/en/messages.json')
  ])
  return emojiData(emojis.default, messages.default)
}
