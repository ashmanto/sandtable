/** The part of Electron's `powerSaveBlocker` that keep-awake uses. */
type Blocker = {
  start(type: 'prevent-app-suspension'): number
  stop(id: number): void
}

type KeepAwake = {
  update(): void
  enabled(): boolean
  setEnabled(on: boolean): void
  active(): boolean
}

/** Creates the keep-awake control, which holds the block only while `enabled` and `running()`. */
export function createKeepAwake(deps: {
  blocker: Blocker
  running: () => boolean
  enabled: boolean
  onActive: (active: boolean) => void
}): KeepAwake {
  let enabled = deps.enabled
  let id: number | null = null
  const set = (want: boolean): void => {
    if (want === (id !== null)) return
    if (want) id = deps.blocker.start('prevent-app-suspension')
    else {
      deps.blocker.stop(id as number)
      id = null
    }
    deps.onActive(want)
  }
  const update = (): void => set(enabled && deps.running())
  return {
    update,
    enabled: () => enabled,
    setEnabled(on) {
      enabled = on
      update()
    },
    active: () => id !== null
  }
}
