/** The largest image you can send to a session. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** The file extension Sandtable saves each image type it sends with. */
export const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

/** Why an image of `type` and `size` bytes can't be sent, or null when it can. */
export const imageProblem = (type: string, size: number): string | null =>
  !Object.hasOwn(IMAGE_TYPES, type)
    ? 'Sandtable sends PNG, JPEG, GIF, and WebP images.'
    : size > MAX_IMAGE_BYTES
      ? "Images over 10 MB can't be sent."
      : null

/** A message that mentions each image as a quoted `@` path before `text`, which Claude Code attaches or reads. */
export function withImages(paths: string[], text: string): string {
  const mentions = paths.map((p) => `@"${p}"`).join(' ')
  // A mention that ends the input leaves Claude Code's file picker open, and Enter picks a file.
  return !paths.length ? text : text ? `${mentions}\n\n${text}` : `${mentions} `
}

/** The paths of session `sessionId`'s images that start `message`, and the text after them. */
export function imagesOf(message: string, sessionId: string): { paths: string[]; text: string } {
  const mention = new RegExp(`^@"([^"]*/images/${sessionId}/[^"/]+)"(?: |\\n\\n|$)`)
  const paths: string[] = []
  let text = message
  for (let m = mention.exec(text); m; m = mention.exec(text)) {
    paths.push(m[1])
    text = text.slice(m[0].length)
  }
  return { paths, text }
}
