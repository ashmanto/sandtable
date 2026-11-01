import { Switch } from '@/components/ui/switch'
import { useSetting } from '@/hooks/useSetting'

/** A switch for an on-or-off setting, loaded from and saved to the main process. */
export function SettingSwitch({
  load,
  save,
  ...props
}: {
  load: () => Promise<boolean>
  save: (on: boolean) => Promise<void>
  id: string
  'aria-describedby': string
}): React.JSX.Element | null {
  const [on, setOn] = useSetting(load, save)
  if (on === null) return null
  return <Switch {...props} checked={on} onCheckedChange={setOn} />
}
