import emojis from 'emojibase-data/en/data.json'
import messages from 'emojibase-data/en/messages.json'
import { describe, expect, it } from 'vitest'
import { emojiData } from './emojiData'

const data = emojiData(emojis, messages)
const find = (emoji: string): (typeof data.emojis)[number] | undefined =>
  data.emojis.find((e) => e.emoji === emoji)

describe('emojiData', () => {
  it('lists the groups but the component group as categories, capitalized', () => {
    expect(data.locale).toBe('en')
    expect(data.categories[0]).toEqual({ index: 0, label: 'Smileys & emotion' })
    expect(data.categories.map((c) => c.label)).not.toContain('Components')
  })

  it('maps an emoji with its category, capitalized label, version, and tags', () => {
    expect(find('😀')).toMatchObject({
      category: 0,
      label: 'Grinning face',
      version: 1,
      tags: expect.arrayContaining(['grin'])
    })
  })

  it('keeps skin tones by name and multi-tone skins as aliases', () => {
    expect(find('👍')?.skins).toEqual({
      light: '👍🏻',
      'medium-light': '👍🏼',
      medium: '👍🏽',
      'medium-dark': '👍🏾',
      dark: '👍🏿'
    })
    expect(find('🤝')?.aliases?.length).toBeGreaterThan(0)
    expect(data.skinTones.light).toBe('Light skin tone')
  })

  it('drops emoji newer than Emoji 17', () => {
    expect(find('🫫')).toBeUndefined()
    expect(find('🫪')).toMatchObject({ version: 17 })
  })
})
