import { describe, expect, it } from 'vitest'
import { imageProblem, imagesOf, MAX_IMAGE_BYTES, withImages } from './images'

const dir = '/data dir/images/s1'

describe('withImages', () => {
  it('puts each path as a quoted @-mention before the text', () => {
    expect(withImages([`${dir}/a.png`, `${dir}/b.jpg`], 'Look')).toBe(
      `@"${dir}/a.png" @"${dir}/b.jpg"\n\nLook`
    )
  })

  it('sends the text alone, or the images alone', () => {
    expect(withImages([], 'Look')).toBe('Look')
    expect(withImages([`${dir}/a.png`], '')).toBe(`@"${dir}/a.png" `)
  })
})

describe('imagesOf', () => {
  it('splits the session images off the start of a message', () => {
    expect(imagesOf(withImages([`${dir}/a.png`, `${dir}/b.webp`], 'Look'), 's1')).toEqual({
      paths: [`${dir}/a.png`, `${dir}/b.webp`],
      text: 'Look'
    })
    expect(imagesOf(`@"${dir}/a.png" `, 's1')).toEqual({ paths: [`${dir}/a.png`], text: '' })
  })

  it("leaves mentions that aren't this session's images in the text", () => {
    for (const text of [`@"/repo/a.png" hi`, `@"/data/images/s2/a.png" hi`, `hi @"${dir}/a.png"`])
      expect(imagesOf(text, 's1')).toEqual({ paths: [], text })
  })
})

describe('imageProblem', () => {
  it('accepts PNG, JPEG, GIF, and WebP up to the limit', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
      expect(imageProblem(type, MAX_IMAGE_BYTES)).toBeNull()
    expect(imageProblem('constructor', 1)).not.toBeNull()
  })

  it('refuses another type, and an image over the limit, naming it', () => {
    expect(imageProblem('image/svg+xml', 1)).toBe(
      'Sandtable sends PNG, JPEG, GIF, and WebP images.'
    )
    expect(imageProblem('image/png', MAX_IMAGE_BYTES + 1)).toBe("Images over 10 MB can't be sent.")
  })
})
