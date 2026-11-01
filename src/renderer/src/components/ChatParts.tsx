import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Step } from '../../../shared/types'
import type { useFollowEnd } from '@/hooks/useFollowEnd'
import { ArrowDown, Sparkles } from 'lucide-react'
import { stepLook, stepText } from '@/lib/activity'
import { Words } from './Activity'
import { bare, field } from './NewTicketComposer'
import { Said } from './TabContent'
import { Tip } from './Tip'

/** A scroller that follows its end, with a **Scroll to end** button while you're away from it. */
export function FollowScroller({
  follower,
  away,
  onEnd,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  follower: ReturnType<typeof useFollowEnd>['ref']
  away: boolean
  onEnd: () => void
}): React.JSX.Element {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={follower} className={cn('min-h-0 flex-1 overflow-y-auto', className)} {...props} />
      {away && (
        <Tip label="Scroll to end">
          <Button
            size="icon-sm"
            variant="ghost"
            className="absolute inset-x-0 bottom-3 z-10 mx-auto animate-in bg-popover text-fg-2 shadow-md ring-1 ring-line-2 duration-200 ease-(--ease-out-cubic) fade-in slide-in-from-bottom-1.5 hover:bg-popover hover:text-fg motion-reduce:slide-in-from-bottom-0"
            onClick={onEnd}
          >
            <ArrowDown />
          </Button>
        </Tip>
      )}
    </div>
  )
}

/** One turn of a chat with Claude, with any lines of note under it. */
export type Turn = { user: boolean; text: string; notes?: string[] }

/** A chat's turns, yours in a `card` bubble. */
export function Turns({ turns }: { turns: Turn[] }): React.JSX.Element {
  return (
    <ol className="flex flex-col gap-4">
      {turns.map((t, i) => (
        <li
          key={i}
          className={cn('flex min-w-0 flex-col gap-1', t.user && 'rounded-card bg-card px-3 py-2')}
        >
          <Said user={t.user} text={t.text} />
          {t.notes?.map((note) => (
            <p key={note} className="text-xs text-fg-3">
              {note}
            </p>
          ))}
        </li>
      ))}
    </ol>
  )
}

/** What Claude is doing as a status line: its latest step, shimmering beside the step's tool key, or `children` before the first step; screen readers hear only `children`. */
export function Working({
  children,
  step
}: {
  children: React.ReactNode
  step?: Step
}): React.JSX.Element {
  const Icon = step ? stepLook(step).icon : Sparkles
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span key={step && stepLook(step).verb} aria-hidden className="tool-key">
        <Icon className="size-[11px]" />
      </span>
      <p role="status" className={step ? 'sr-only' : 'shimmer'}>
        {children}
      </p>
      {step && (
        <span
          key={stepText(step)}
          title={stepText(step)}
          className="flex min-w-0 animate-in duration-200 ease-(--ease-out-cubic) fade-in slide-in-from-bottom-1.5 motion-reduce:slide-in-from-bottom-0"
        >
          <span className="truncate shimmer">
            <Words step={step} />
          </span>
        </span>
      )}
    </div>
  )
}

/** A chat's message box, sent with Enter or **Send** unless `onKey` prevents the key's default, that takes pasted and dropped files when it can attach them. */
export function Composer({
  value,
  placeholder,
  disabled,
  boxRef,
  onChange,
  onSend,
  onStop,
  onFiles,
  attachments,
  canSend = value.trim() !== '',
  box,
  onKey,
  overlay,
  children
}: {
  value: string
  placeholder: string
  disabled: boolean
  boxRef: React.Ref<HTMLTextAreaElement>
  onChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  onFiles?: (files: File[]) => void
  attachments?: React.ReactNode
  canSend?: boolean
  box?: React.AriaAttributes & { role?: React.AriaRole }
  onKey?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  overlay?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  const [dropping, setDropping] = useState(false)
  return (
    <div
      className={cn(field, 'relative pb-2', dropping && 'ring-ring')}
      onDragOver={(e) => {
        if (!onFiles || disabled || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files]
        setDropping(false)
        if (!onFiles || disabled || !files.length) return
        e.preventDefault()
        onFiles(files)
      }}
    >
      {overlay}
      <textarea
        {...box}
        ref={boxRef}
        aria-label="Message"
        placeholder={placeholder}
        rows={3}
        className={cn(
          bare,
          'max-h-60 min-h-14 text-fg disabled:cursor-not-allowed disabled:opacity-50'
        )}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const files = [...e.clipboardData.files]
          if (!onFiles || !files.length || e.clipboardData.getData('text/plain')) return
          e.preventDefault()
          onFiles(files)
        }}
        onKeyDown={(e) => {
          onKey?.(e)
          if (e.defaultPrevented || e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing)
            return
          e.preventDefault()
          onSend()
        }}
      />
      <div className="flex items-center gap-2">
        {attachments}
        {children}
        {onStop ? (
          <Button size="sm" className="ml-auto" onClick={(e) => e.detail < 2 && onStop()}>
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            className="ml-auto"
            disabled={disabled || !canSend}
            onClick={() => onSend()}
          >
            Send
          </Button>
        )}
      </div>
      {dropping && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center rounded-card bg-card/90 text-fg-2"
        >
          Drop to attach
        </div>
      )}
    </div>
  )
}
