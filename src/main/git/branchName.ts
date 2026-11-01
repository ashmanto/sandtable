/** Builds a branch name from a ticket number or Linear or Jira key and title: `<prefix>-<ascii-slug>`, at most 50 characters. */
export function branchName(prefix: number | string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${prefix}-${slug}`.slice(0, 50).replace(/-+$/, '')
}
