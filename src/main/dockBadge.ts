type DockBadge = {
  setCount(count: number): void
  setActive(active: boolean): void
}

/** Creates the Dock badge, which shows a count above zero while Sandtable isn't the active app. */
export function createDockBadge(setBadge: (text: string) => void): DockBadge {
  let count = 0
  let active = false
  const update = (): void => setBadge(active || count === 0 ? '' : String(count))
  return {
    setCount(n) {
      count = n
      update()
    },
    setActive(on) {
      active = on
      update()
    }
  }
}
