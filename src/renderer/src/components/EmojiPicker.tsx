import {
  EmojiPicker as Picker,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps
} from 'frimousse'
import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { inputClass } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { resolveEmojiData } from '@/lib/emojiData'
import { Problem, Spinner } from './StepFlow'

const CategoryHeader = ({
  category,
  ...props
}: EmojiPickerListCategoryHeaderProps): React.JSX.Element => (
  <div {...props} className="bg-popover px-1 pt-2 pb-1 text-xs font-medium text-fg-3">
    {category.label}
  </div>
)

const Emoji = ({ emoji, ...props }: EmojiPickerListEmojiProps): React.JSX.Element => (
  <button
    type="button"
    {...props}
    className={cn(
      'grid size-8 place-items-center rounded-md text-xl',
      emoji.isActive && 'bg-surface-3'
    )}
  >
    {emoji.emoji}
  </button>
)

/** A button that opens a searchable emoji grid and hands back the emoji picked. */
export function EmojiPicker({
  ref,
  label,
  onPick
}: {
  ref?: React.Ref<HTMLButtonElement>
  label: string
  onPick: (emoji: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const resolve = useCallback(
    () =>
      resolveEmojiData().catch((err) => {
        setFailed(true)
        throw err
      }),
    []
  )
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        setFailed(false)
      }}
    >
      <PopoverTrigger asChild>
        <Button ref={ref} variant="outline" size="xs">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label="Emoji" className="w-80 p-2">
        <Picker.Root
          resolveEmojiData={resolve}
          onEmojiSelect={({ emoji }) => {
            onPick(emoji)
            setOpen(false)
          }}
          className="flex flex-col gap-2"
        >
          <Picker.Search
            aria-label="Search emoji"
            placeholder="Search emoji"
            className={cn(inputClass, 'h-8 px-2.5')}
          />
          <Picker.Viewport className="h-58">
            {failed ? (
              <Problem title="Couldn't load emoji." />
            ) : (
              <Picker.Loading className="absolute inset-0 flex items-center justify-center gap-1.5 text-fg-2">
                <Spinner />
                Loading emoji…
              </Picker.Loading>
            )}
            <Picker.Empty
              role="status"
              className="absolute inset-0 flex items-center justify-center text-fg-2"
            >
              No emoji match
            </Picker.Empty>
            <Picker.List aria-label="Emoji" components={{ CategoryHeader, Emoji }} />
          </Picker.Viewport>
        </Picker.Root>
      </PopoverContent>
    </Popover>
  )
}
