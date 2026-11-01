import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { ProjectRepo } from '../../../shared/types'

/** A radio choice in a box with a title and an optional line of help under it. */
export function RadioBox({
  name,
  checked,
  title,
  help,
  autoFocus,
  disabled,
  onChange
}: {
  name: string
  checked: boolean
  title: React.ReactNode
  help?: string
  autoFocus?: boolean
  disabled?: boolean
  onChange: () => void
}): React.JSX.Element {
  return (
    <label
      className={cn(
        'highlight flex w-full items-start gap-2.5 rounded-card bg-fg/5 px-3 py-2.5 text-left hover:bg-fg/8 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50',
        checked && 'bg-fg/8',
        disabled && 'opacity-50'
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full border border-line-2',
          checked && 'border-foreground'
        )}
      >
        {checked && <span className="size-1.5 rounded-full bg-foreground" />}
      </span>
      <span>
        <span className="block font-medium">{title}</span>{' '}
        {help && <span className="mt-0.5 block text-xs text-fg-2">{help}</span>}
      </span>
    </label>
  )
}

const heading = 'text-xs font-medium text-muted-foreground'

/** A field's heading, a label when `htmlFor` is given, with a mark beside it outside its name. */
export function FieldHeading({
  id,
  htmlFor,
  mark,
  className = heading,
  children
}: {
  id?: string
  htmlFor?: string
  mark?: React.ReactNode
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={className}>
          {children}
        </label>
      ) : (
        <p id={id} className={className}>
          {children}
        </p>
      )}
      {mark}
    </div>
  )
}

/** The Repo radio group of a project with more than one repo; renders nothing otherwise. */
export function RepoPicker({
  repos,
  name,
  value,
  legend = 'Repo',
  mark,
  onChange,
  children
}: {
  repos: ProjectRepo[]
  name: string
  value: string
  legend?: string
  mark?: React.ReactNode
  onChange: (github: string) => void
  children?: React.ReactNode
}): React.JSX.Element | null {
  if (repos.length < 2) return null
  return (
    <div className="flex flex-col gap-1.5">
      <FieldHeading id={name} mark={mark}>
        {legend}
      </FieldHeading>
      <div role="radiogroup" aria-labelledby={name} className="flex flex-col gap-2">
        {repos.map((r) => (
          <RadioBox
            key={r.github}
            name={name}
            checked={value === r.github}
            title={r.github}
            onChange={() => onChange(r.github)}
          />
        ))}
      </div>
      {children}
    </div>
  )
}

/** The Where radio group of a session without a ticket: the repo's main checkout or a new worktree. */
export function WherePicker({
  name,
  legend,
  path,
  worktree,
  mark,
  onChange,
  children
}: {
  name: string
  legend: string
  path?: string
  worktree: boolean
  mark?: React.ReactNode
  onChange: (worktree: boolean) => void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldHeading id={name} mark={mark}>
        {legend}
      </FieldHeading>
      <div role="radiogroup" aria-labelledby={name} className="flex flex-col gap-2">
        <RadioBox
          name={name}
          checked={!worktree}
          title="Main checkout"
          help={`Runs in ${path}, the folder you also work in, so it can change your files there.`}
          onChange={() => onChange(false)}
        />
        <RadioBox
          name={name}
          checked={worktree}
          title="New worktree"
          help="Gets its own branch and worktree, for changing code."
          onChange={() => onChange(true)}
        />
      </div>
      {children}
    </div>
  )
}

/** The First message field of a session without a ticket or a routine. */
export function MessageField({
  id,
  value,
  placeholder,
  mark,
  onChange,
  children
}: {
  id: string
  value: string
  placeholder?: string
  mark?: React.ReactNode
  onChange: (message: string) => void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldHeading htmlFor={id} mark={mark}>
        First message
      </FieldHeading>
      <Textarea
        id={id}
        placeholder={placeholder}
        rows={3}
        className="max-h-60"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {children}
    </div>
  )
}
