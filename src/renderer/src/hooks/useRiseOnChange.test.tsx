import { afterEach, describe, expect, it } from 'vitest'
import { jumpToCard } from './useRiseOnChange'

afterEach(() => document.body.replaceChildren())

describe('jumpToCard', () => {
  it("focuses the card's copy in the lane you jump from, and is false when no card shows", () => {
    document.body.innerHTML = `
      <section><div data-ticket="APP-7" tabindex="0" id="a"></div></section>
      <section><div data-ticket="APP-7" tabindex="0" id="b"></div><button id="from"></button></section>`
    document.getElementById('from')!.focus()
    expect(jumpToCard('APP-7')).toBe(true)
    expect(document.activeElement?.id).toBe('b')
    expect(jumpToCard('APP-99')).toBe(false)
  })
})
