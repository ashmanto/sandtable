import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { onEnter, plural } from '@/lib/utils'
import { STATUS_FIELDS, type BoardSource } from '../hooks/useBoardSource'
import { LabeledSelect, LoadState, Problem } from './StepFlow'

/** The GitHub Projects board step: URL, load, and a board status for each column. */
export function BoardStep({ source }: { source: BoardSource }): React.JSX.Element {
  const { url, loading, board, statusMap } = source
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="board-url">Board URL</Label>
        <div className="flex gap-2">
          <Input
            id="board-url"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            placeholder="https://github.com/users/you/projects/1"
            value={url}
            onChange={(e) => source.changeUrl(e.target.value)}
            onKeyDown={onEnter(() => !loading && source.load())}
          />
          <Button
            variant="outline"
            size="lg"
            disabled={loading || !url.trim()}
            onClick={() => source.load()}
          >
            {board ? 'Reload' : 'Load board'}
          </Button>
        </div>
      </div>
      {source.badUrl ? (
        <Problem title="Enter a board URL such as https://github.com/users/you/projects/1" />
      ) : (
        <LoadState
          loading={loading}
          text="Loading board…"
          failed={source.error ? { title: "Couldn't load the board.", detail: source.error } : null}
          onRetry={source.load}
        >
          {board && (
            <p role="status" className="flex items-center gap-1.5 text-fg-2">
              <Check className="size-3.5" />
              Board loaded: tickets from {plural(board.repos.length, 'repo')}
            </p>
          )}
        </LoadState>
      )}
      {board && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium">Board status for each column</legend>
          <div className="grid grid-cols-3 gap-3">
            {STATUS_FIELDS.map((f) => (
              <LabeledSelect
                key={f.key}
                id={`status-${f.key}`}
                label={f.label}
                small
                value={statusMap[f.key] ?? ''}
                onChange={(v) => source.setStatus(f.key, v)}
                options={board.options.map((o) => ({ value: o, label: o }))}
              />
            ))}
          </div>
        </fieldset>
      )}
    </div>
  )
}

/** The board as the Review step's Tickets from row lists it. */
export function BoardReview({ source }: { source: BoardSource }): React.JSX.Element {
  return (
    <>
      <span>GitHub Projects board</span>
      <span className="truncate font-mono text-xs text-fg-2">{source.url.trim()}</span>
    </>
  )
}

/** The board status chosen for each column, as the Review step's Columns row lists them. */
export function BoardColumns({ source }: { source: BoardSource }): React.JSX.Element {
  return (
    <>
      {STATUS_FIELDS.map((f) => (
        <span key={f.key} className="flex gap-2">
          <span className="text-fg-2">{f.label}</span>
          <span>{source.statusMap[f.key]}</span>
        </span>
      ))}
    </>
  )
}
