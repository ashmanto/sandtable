import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDrafts } from './drafts'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'sandtable-drafts-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const image = { id: 'i1', name: 'a.png', size: 3, url: 'data:image/png;base64,AAA=' }

describe('drafts', () => {
  it('is null when nothing is saved', async () => {
    expect(await createDrafts(dir).get('session:s1')).toBeNull()
  })

  it('keeps text and images across instances, each part saved on its own', async () => {
    const drafts = createDrafts(dir)
    drafts.save('session:s1', { text: 'first' })
    drafts.save('session:s1', { images: [image] })
    drafts.save('session:s1', { text: 'Hello' })
    await drafts.flush()
    expect(await createDrafts(dir).get('session:s1')).toEqual({ text: 'Hello', images: [image] })
    expect(await createDrafts(dir).get('session:s2')).toBeNull()
  })

  it('removes a draft once its parts are empty', async () => {
    const drafts = createDrafts(dir)
    drafts.save('chat:p1\0o/r#1', { text: 'Hi', images: [image] })
    await drafts.flush()
    drafts.save('chat:p1\0o/r#1', { text: '', images: [] })
    expect(await drafts.get('chat:p1\0o/r#1')).toBeNull()
    expect(await fs.readdir(dir)).toEqual([])
  })

  it('keeps a key with slashes inside the folder', async () => {
    const drafts = createDrafts(dir)
    drafts.save('../../x', { text: 'Hi' })
    await drafts.flush()
    expect(await fs.readdir(dir)).toHaveLength(1)
  })

  it('drops parts of the wrong shape', async () => {
    const drafts = createDrafts(dir)
    drafts.save('k', { text: 'Hi', images: [image, { id: 1 } as never] })
    await drafts.flush()
    expect(await drafts.get('k')).toEqual({ text: 'Hi', images: [image] })
  })
})
