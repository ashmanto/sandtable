/** A before-quit handler that holds every quit until `flush` settles or 5 seconds pass. */
export function quitAfter(
  flush: () => Promise<unknown>,
  quit: () => void
): (e: { preventDefault(): void }) => void {
  let quitting = false
  let done = false
  return (e) => {
    if (done) return
    e.preventDefault()
    if (quitting) return
    quitting = true
    const limit = new Promise((resolve) => setTimeout(resolve, 5000))
    void Promise.race([Promise.resolve().then(flush), limit])
      .catch((err) => console.error('Sandtable could not finish saving before quitting', err))
      .finally(() => {
        done = true
        quit()
      })
  }
}
