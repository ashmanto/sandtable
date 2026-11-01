import { Check, Copy } from 'lucide-react'
import { createContext, useContext } from 'react'
import Markdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCopy } from '../hooks/useCopy'
import { Tip } from './Tip'

type Node = ExtraProps['node']

const codeOf = (pre: Node): { code: string; language: string | undefined } => {
  const code = pre?.children[0]
  if (code?.type !== 'element') return { code: '', language: undefined }
  const text = code.children.map((c) => (c.type === 'text' ? c.value : '')).join('')
  const language = [code.properties.className ?? []]
    .flat()
    .map(String)
    .find((c) => c.startsWith('language-'))
  return { code: text.replace(/\n$/, ''), language: language?.slice('language-'.length) }
}

const sourceOf = (text: string, node: Node): string => {
  const { start, end } = node?.position ?? {}
  if (start?.offset === undefined || end?.offset === undefined) return ''
  return text
    .slice(start.offset, end.offset)
    .split('\n')
    .map((line, i) =>
      i ? line.slice(Math.min(start.column - 1, /^[\s>]*/.exec(line)![0].length)) : line
    )
    .join('\n')
}

const Source = createContext('')

function CopyBlock({
  label,
  what,
  text,
  children
}: {
  label: string
  what: string
  text: string
  children: React.ReactNode
}): React.JSX.Element {
  const { copied, copy } = useCopy()
  return (
    <div className="group rounded-sm bg-neutral-soft">
      <div
        data-find-skip
        className="flex h-7 items-center justify-between gap-2 border-b border-line pr-0.5 pl-3 text-xs text-fg-3"
      >
        <span>{label}</span>
        <Tip label={copied ? 'Copied' : `Copy ${what}`}>
          <Button
            size="xs"
            variant="ghost"
            className={cn(
              'text-fg-3 group-focus-within:opacity-100 group-hover:opacity-100',
              !copied && 'opacity-0'
            )}
            onClick={() => copy(text)}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </Tip>
        <span role="status" className="sr-only">
          {copied && 'Copied'}
        </span>
      </div>
      {children}
    </div>
  )
}

const PLAIN: Components = {
  a: ({ node: _, ...p }) => <a {...p} title={p.href} target="_blank" rel="noreferrer" />,
  th: ({ node: _, children, ...p }) => (
    <th {...p}>
      <div>{children}</div>
    </th>
  ),
  td: ({ node: _, children, ...p }) => (
    <td {...p}>
      <div>{children}</div>
    </td>
  )
}

const WITH_COPY: Components = {
  ...PLAIN,
  pre: ({ node, ...p }) => {
    const { code, language } = codeOf(node)
    return (
      <CopyBlock label={language ?? 'Code'} what="code" text={code}>
        <pre {...p} className="rounded-none bg-transparent" />
      </CopyBlock>
    )
  },
  table: function Table({ node, ...p }) {
    return (
      <CopyBlock label="Table" what="table" text={sourceOf(useContext(Source), node)}>
        <table {...p} className="mx-3 my-2" />
      </CopyBlock>
    )
  }
}

/** GitHub-flavored Markdown with raw HTML skipped and links opening in the browser, and with `copy`, a Copy bar on each code block and table. */
export function Md({ children, copy }: { children: string; copy?: boolean }): React.JSX.Element {
  return (
    <div className="markdown">
      <Source.Provider value={children}>
        <Markdown remarkPlugins={[remarkGfm]} skipHtml components={copy ? WITH_COPY : PLAIN}>
          {children}
        </Markdown>
      </Source.Provider>
    </div>
  )
}

/** One message of a conversation: who wrote it, over its Markdown, with Copy bars when `copy`. */
export function Said({
  user,
  text,
  copy
}: {
  user: boolean
  text: string
  copy?: boolean
}): React.JSX.Element {
  return (
    <>
      <p data-find-skip className="text-xs text-fg-3">
        {user ? 'You' : 'Claude'}
      </p>
      <Md copy={copy}>{text}</Md>
    </>
  )
}

/** A failure line in `danger` with Retry. */
export function LoadError({
  text,
  onRetry,
  className
}: {
  text: string
  onRetry: () => void
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'm-6 flex items-center gap-3 rounded-sm bg-danger-soft px-3 py-2 text-danger',
        className
      )}
    >
      <p className="flex-1">{text}</p>
      <Button size="xs" variant="ghost" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

/** A label over skeleton bars while a tab loads. */
export function Loading({
  label,
  className
}: {
  label: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('mx-auto flex w-full max-w-180 flex-col gap-3 px-8 py-6', className)}>
      <p className="text-xs text-fg-3">{label}</p>
      {['w-3/4', 'w-full', 'w-5/6', 'w-2/3'].map((w) => (
        <div key={w} className={cn('h-3 rounded-sm bg-surface-3', w)} />
      ))}
    </div>
  )
}

/** A centered title and line of text in place of a tab's content, with any actions under them. */
export function Message({
  title,
  text,
  children
}: {
  title: string
  text: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="m-auto flex max-w-100 flex-col gap-1 p-6 text-center">
      <p>{title}</p>
      <p className="text-fg-2">{text}</p>
      {children}
    </div>
  )
}
