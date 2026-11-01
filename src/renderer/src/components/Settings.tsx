import { useCallback, useEffect, useState } from 'react'
import { LIMIT_PCTS } from '../../../shared/sessionStatus'
import { authCommand } from '../../../shared/setup'
import type { Account, NotificationSettings, Theme } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useSetting } from '@/hooks/useSetting'
import { useRun } from '@/hooks/useRun'
import { cn, home } from '@/lib/utils'
import { LeftoverList } from './LeftoverList'
import { CommandBox } from './SetupGuide'
import { Problem } from './StepFlow'
import { SettingSwitch } from './SettingSwitch'
import { Segmented } from './Segmented'
import { BackView } from './ViewHeader'

const themes: [Theme, string][] = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark']
]

const card = 'flex items-center gap-4 rounded-card bg-card p-4'

function Row({
  id,
  label,
  help,
  children
}: {
  id: string
  label: string
  help?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={card}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor={id}>{label}</label>
        {help && (
          <span id={`${id}-help`} className="text-xs text-fg-2">
            {help}
          </span>
        )}
      </span>
      {children}
    </div>
  )
}

const SIGNED_IN = { true: 'Signed in', false: 'Not signed in', null: "Can't check" }

const nameOf = (dir: string): string =>
  /\/\.claude-([A-Za-z0-9][A-Za-z0-9-]*)$/.exec(dir)?.[1] ?? ''

function Accounts(): React.JSX.Element {
  const api = window.sandtable.accounts
  const [accounts, setAccounts] = useState<Account[]>([])
  const [signedIn, setSignedIn] = useState<Record<string, boolean | null>>({})
  const [form, setForm] = useState<Account | null>(null)
  const [folders, setFolders] = useState<string[]>([])
  const { error, pending, clear, run } = useRun()

  const check = useCallback(
    (list: Account[]): void => {
      for (const a of list)
        void api.signedIn(a.dir).then((v) => setSignedIn((s) => ({ ...s, [a.dir]: v })))
    },
    [api]
  )
  const load = useCallback(async (): Promise<void> => {
    const list = await api.list()
    setAccounts(list)
    check(list)
  }, [api, check])
  useEffect(() => {
    void run(load)
  }, [run, load])
  useEffect(() => {
    const recheck = (): void => check(accounts)
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  }, [check, accounts])

  const attempt = (action: () => Promise<void>): Promise<boolean> =>
    run(async () => {
      await action()
      await load()
    })

  function openForm(): void {
    setForm({ name: '', dir: '' })
    void api.folders().then(setFolders)
  }

  return (
    <>
      <p className="text-xs text-fg-2">
        You pick one for each project when you add or edit it. Default is the account Claude Code
        uses on its own.
      </p>
      {accounts.map((a, i) => {
        const state = signedIn[a.dir]
        return (
          <div
            key={a.dir}
            role="group"
            aria-label={a.name}
            className={cn(card, 'flex-col items-stretch gap-3')}
          >
            <div className="flex items-center gap-4">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span>{a.name}</span>
                <span className="truncate font-mono text-xs text-fg-2" title={a.dir}>
                  {home(a.dir)}
                </span>
              </span>
              <span className="text-xs text-fg-2">
                {state === undefined ? 'Checking…' : SIGNED_IN[`${state}`]}
              </span>
              {i > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Remove ${a.name}`}
                  disabled={pending}
                  onClick={() => void attempt(() => api.remove(a.dir))}
                >
                  Remove
                </Button>
              )}
            </div>
            {state === false && (
              <CommandBox command={authCommand('login', i > 0 ? a.dir : undefined)} />
            )}
          </div>
        )
      })}
      {error && <Problem title={error} />}
      {form ? (
        <form
          className={cn(card, 'flex-col items-stretch gap-3')}
          onSubmit={(e) => {
            e.preventDefault()
            void attempt(async () => {
              await api.add(form)
              setForm(null)
            })
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-name">Name</Label>
            <Input
              id="account-name"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-folder">Folder</Label>
            <Input
              id="account-folder"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              placeholder="~/.claude-work"
              value={form.dir}
              onChange={(e) => setForm({ ...form, dir: e.target.value })}
            />
          </div>
          {folders.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {folders.map((f) => (
                <Button
                  key={f}
                  type="button"
                  variant="outline"
                  size="xs"
                  className="font-mono"
                  onClick={() =>
                    setForm({
                      name: !form.name || form.name === nameOf(form.dir) ? nameOf(f) : form.name,
                      dir: home(f)
                    })
                  }
                >
                  {home(f)}
                </Button>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setForm(null)
                clear()
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              Add
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" size="sm" className="self-start" onClick={openForm}>
          Add account
        </Button>
      )}
    </>
  )
}

function Notifications(): React.JSX.Element {
  const { error, run } = useRun()
  const [prefs, setPrefs] = useSetting(
    window.sandtable.app.notifications,
    window.sandtable.app.setNotifications
  )
  const toggle = (
    key: Exclude<keyof NotificationSettings, 'limitPct'>,
    props: React.ComponentProps<typeof Switch>
  ): React.JSX.Element | null =>
    prefs && (
      <Switch
        {...props}
        checked={prefs[key]}
        onCheckedChange={(on) => setPrefs({ ...prefs, [key]: on })}
      />
    )
  return (
    <>
      <Row
        id="notify"
        label="Notify when a session needs you"
        help={
          <>
            Cards still show <b className="font-medium">Needs you</b> when this is off.
          </>
        }
      >
        {toggle('notify', { id: 'notify', 'aria-describedby': 'notify-help' })}
      </Row>
      <Row id="notify-sound" label="Play a sound">
        {toggle('sound', {
          id: 'notify-sound',
          disabled: !prefs?.notify && prefs?.limitPct === null
        })}
      </Row>
      <Row id="notify-quiet" label="Don't notify while Sandtable is in front">
        {toggle('quietWhenFocused', { id: 'notify-quiet', disabled: !prefs?.notify })}
      </Row>
      <Row
        id="notify-limit"
        label="Notify when a plan limit passes"
        help="For the 5-hour and 7-day limits, once per window, even while Sandtable is in front."
      >
        {prefs && (
          <Select
            value={String(prefs.limitPct ?? 'off')}
            onValueChange={(v) => setPrefs({ ...prefs, limitPct: v === 'off' ? null : Number(v) })}
          >
            <SelectTrigger id="notify-limit" aria-describedby="notify-limit-help" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIMIT_PCTS.map((pct) => (
                <SelectItem key={pct} value={String(pct)}>
                  {pct}%
                </SelectItem>
              ))}
              <SelectItem value="off">Off</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Row>
      <div className={card}>
        <span className="min-w-0 flex-1 text-fg-2">
          Banners, alerts, and the lock screen are set in macOS.
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void run(window.sandtable.app.openNotificationSettings)}
        >
          Open Notification Settings
        </Button>
      </div>
      {error && <Problem title={error} />}
    </>
  )
}

/** The Settings screen: a header with Back, then one section per group of settings. */
export function Settings({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [theme, setTheme] = useSetting(window.sandtable.app.theme, window.sandtable.app.setTheme)
  return (
    <BackView title="Settings" onBack={onBack}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="m-6 flex max-w-130 flex-col gap-2">
          <h2 id="appearance" className="font-medium">
            Appearance
          </h2>
          <div className={card}>
            <span className="min-w-0 flex-1 text-fg-2">
              <b className="font-medium">System</b> follows macOS.
            </span>
            {theme && (
              <Segmented
                options={themes}
                value={theme}
                onChange={setTheme}
                aria-labelledby="appearance"
                className="w-56"
              />
            )}
          </div>
        </section>
        <section className="m-6 flex max-w-130 flex-col gap-2">
          <h2 className="font-medium">Sleep</h2>
          <Row
            id="keep-awake"
            label="Keep your Mac awake while sessions run"
            help="With the lid closed, this works only when your Mac is on power and connected to a display."
          >
            <SettingSwitch
              id="keep-awake"
              aria-describedby="keep-awake-help"
              load={window.sandtable.app.keepAwake}
              save={window.sandtable.app.setKeepAwake}
            />
          </Row>
        </section>
        <section className="m-6 flex max-w-130 flex-col gap-2">
          <h2 className="font-medium">Remote Control</h2>
          <Row
            id="remote-control"
            label="Start sessions with Remote Control on"
            help="Follow and steer sessions from claude.ai or the Claude app. A project can override this in Edit project."
          >
            <SettingSwitch
              id="remote-control"
              aria-describedby="remote-control-help"
              load={window.sandtable.app.remoteControl}
              save={window.sandtable.app.setRemoteControl}
            />
          </Row>
        </section>
        <section className="m-6 flex max-w-130 flex-col gap-2">
          <h2 className="font-medium">Claude Code accounts</h2>
          <Accounts />
        </section>
        <section className="m-6 flex max-w-130 flex-col gap-2">
          <h2 className="font-medium">Leftover sessions</h2>
          <LeftoverList />
        </section>
        <section className="m-6 flex max-w-130 flex-col gap-2">
          <h2 className="font-medium">Notifications</h2>
          <Notifications />
        </section>
      </div>
    </BackView>
  )
}
