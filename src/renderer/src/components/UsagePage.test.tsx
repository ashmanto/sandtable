import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MergedTicket, ModelUsage, UsageByWeek, WeekUsage } from '../../../shared/types'
import { fakeSandtable, project } from '../test/fixtures'
import { UsagePage } from './UsagePage'

const opus = (input: number, price: number | null = input / 100): ModelUsage => ({
  model: 'claude-opus-5-5',
  name: 'Opus 5.5',
  input,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  price
})

const projects = [project, { ...project, id: 'p2', name: 'Other', icon: '📦' }]
const thisWeek = '2026-10-26'
const usage: UsageByWeek = {
  all: [
    { week: thisWeek, usage: [opus(200)], workMs: 0 },
    { week: '2026-01-05', usage: [opus(200)], workMs: 0 }
  ],
  projects: [
    { projectId: 'p1', weeks: [{ week: thisWeek, usage: [opus(100)], workMs: 0 }] },
    {
      projectId: 'p2',
      weeks: [
        { week: thisWeek, usage: [opus(100)], workMs: 0 },
        { week: '2026-01-05', usage: [opus(200)], workMs: 0 }
      ]
    }
  ],
  merged: []
}
const one = (weeks: WeekUsage[]): UsageByWeek => ({
  all: weeks,
  projects: [{ projectId: 'p1', weeks }],
  merged: []
})

const at = (day: number, hour: number): string => new Date(2026, 9, day, hour).toISOString()
const merged = (
  projectId: string,
  start: string,
  end: string,
  needsYou: number,
  input: number
): MergedTicket => ({
  projectIds: [projectId],
  ticketKey: `o/r#${input}`,
  startedAt: start,
  mergedAt: end,
  needsYou,
  usage: [opus(input)]
})

const show = (rows: UsageByWeek | Error): ReturnType<typeof fakeSandtable> => {
  const api = fakeSandtable()
  if (rows instanceof Error) vi.mocked(api.projects.usage).mockRejectedValue(rows)
  else vi.mocked(api.projects.usage).mockResolvedValue(rows)
  render(<UsagePage projects={projects} onBack={() => {}} />)
  return api
}

const free = (input: number): ModelUsage => ({
  ...opus(input),
  model: 'x',
  name: null,
  price: null
})

describe('UsagePage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 28, 12))
  })
  afterEach(() => vi.useRealTimers())

  it('lists projects largest first with their share and estimate', async () => {
    show(usage)
    expect(screen.getByRole('status')).toHaveTextContent('Reading transcripts…')
    const all = await screen.findByRole('button', { name: /^All projects/ })
    expect(all).toHaveAttribute('aria-current', 'true')
    const items = within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('button')
    expect(items.map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^All projects400 tokens/),
      expect.stringMatching(/^📦Other300 tokens75% of all use\$3\.00/),
      expect.stringMatching(/^SShop100 tokens25% of all use\$1\.00/)
    ])
    expect(screen.getByText('400 tokens', { selector: 'p' })).toBeInTheDocument()
  })

  it("shows a selected project's usage and weeks", async () => {
    show(usage)
    await userEvent.click(await screen.findByRole('button', { name: /^Shop/ }))
    expect(screen.getByRole('button', { name: /^Shop/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('heading', { level: 2, name: 'Shop' })).toBeInTheDocument()
    expect(screen.getByText('100 tokens', { selector: 'p' })).toBeInTheDocument()
    const weeks = within(screen.getByRole('list', { name: 'By week' })).getAllByRole('listitem')
    expect(weeks.map((w) => w.textContent)).toEqual(['This week100 tokens$1.00 API estimate'])

    await userEvent.click(screen.getByRole('button', { name: /^Other/ }))
    expect(
      within(screen.getByRole('list', { name: 'By week' }))
        .getAllByRole('listitem')
        .map((w) => w.textContent)
    ).toEqual([
      'This week100 tokens$1.00 API estimate',
      'Jan 5 – Jan 11200 tokens$2.00 API estimate'
    ])
  })

  it("shows All projects from the main process's count, not the projects' sum", async () => {
    show({ ...usage, all: [{ week: thisWeek, usage: [opus(150)], workMs: 0 }] })
    expect(await screen.findByRole('heading', { level: 2, name: 'All projects' })).toBeVisible()
    expect(screen.getByRole('button', { name: /^All projects/ }).textContent).toMatch(
      /^All projects150 tokens/
    )
    expect(
      within(screen.getByRole('list', { name: 'By week' }))
        .getAllByRole('listitem')
        .map((w) => w.textContent)
    ).toEqual(['This week150 tokens$1.50 API estimate'])
  })

  it("shows Claude's working time for the selected entry and each week", async () => {
    show({
      all: [
        { week: thisWeek, usage: [opus(200)], workMs: 3_600_000 },
        { week: '2026-01-05', usage: [], workMs: 1_800_000 }
      ],
      projects: [
        { projectId: 'p1', weeks: [{ week: thisWeek, usage: [opus(100)], workMs: 0 }] },
        {
          projectId: 'p2',
          weeks: [
            { week: thisWeek, usage: [opus(100)], workMs: 3_600_000 },
            { week: '2026-01-05', usage: [], workMs: 1_800_000 }
          ]
        }
      ],
      merged: []
    })
    expect(await screen.findByText(/^Claude worked/, { selector: 'p' })).toHaveTextContent(
      'Claude worked 2h2 hours'
    )
    expect(
      within(screen.getByRole('list', { name: 'By week' }))
        .getAllByRole('listitem')
        .map((w) => w.textContent)
    ).toEqual([
      'This week200 tokensClaude worked 1h1 hour$2.00 API estimate',
      'Jan 5 – Jan 110 tokensClaude worked 30m30 minutes'
    ])
    await userEvent.click(screen.getByRole('button', { name: /^Shop/ }))
    expect(screen.queryByText(/Claude worked/)).toBeNull()
    expect(
      within(screen.getByRole('list', { name: 'By week' })).getByRole('listitem').textContent
    ).toBe('This week100 tokens$1.00 API estimate')
  })

  it('selects a project from the keyboard', async () => {
    show(usage)
    await screen.findByRole('button', { name: /^All projects/ })
    await userEvent.tab()
    await userEvent.tab()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: /^Other/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: /^Other/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('heading', { level: 2, name: 'Other' })).toBeInTheDocument()
  })

  it('shows throughput by the week tickets merged, for all projects or one', async () => {
    show({
      ...usage,
      merged: [
        merged('p1', at(27, 9), at(27, 11), 1, 100),
        merged('p2', at(26, 9), at(27, 11), 2, 200),
        merged(
          'p2',
          new Date(2026, 0, 6, 9).toISOString(),
          new Date(2026, 0, 6, 9, 30).toISOString(),
          0,
          50
        )
      ]
    })
    const rows = async (): Promise<(string | null)[]> =>
      within(await screen.findByRole('list', { name: 'Throughput' }))
        .getAllByRole('listitem')
        .map((w) => w.textContent)
    expect(await rows()).toEqual([
      'This weekMerged2Start to merge14h median · 1d 2h slowest14 hours median, 1 day 2 hours slowestPer ticket$1.50 API estimateNeeds you per ticket1.5',
      'Jan 5 – Jan 11Merged1Start to merge30m median · 30m slowest30 minutes median, 30 minutes slowestPer ticket$0.50 API estimateNeeds you per ticket0'
    ])
    await userEvent.click(screen.getByRole('button', { name: /^Shop/ }))
    expect(await rows()).toEqual([
      'This weekMerged1Start to merge2h median · 2h slowest2 hours median, 2 hours slowestPer ticket$1.00 API estimateNeeds you per ticket1'
    ])
  })

  it('says when no ticket merged from a session', async () => {
    show(usage)
    expect(await screen.findByText('No tickets merged from a session yet')).toBeInTheDocument()
  })

  it('shows no estimate where no model has a price', async () => {
    show(one([{ week: thisWeek, usage: [free(100)], workMs: 0 }]))
    const item = await screen.findByRole('button', { name: /^Shop/ })
    expect(item.textContent).toBe('SShop100 tokens100% of all use')
    expect(
      within(screen.getByRole('list', { name: 'By week' })).getByRole('listitem').textContent
    ).toBe('This week100 tokens')
    expect(screen.queryByText(/Leaves out tokens/)).not.toBeInTheDocument()
  })

  it('notes a left-out model only when a shown week leaves one out', async () => {
    show({
      all: [{ week: thisWeek, usage: [opus(200), free(5)], workMs: 0 }],
      projects: [
        { projectId: 'p1', weeks: [{ week: thisWeek, usage: [opus(100)], workMs: 0 }] },
        { projectId: 'p2', weeks: [{ week: thisWeek, usage: [opus(100), free(5)], workMs: 0 }] }
      ],
      merged: []
    })
    expect(
      await screen.findByText('* Leaves out tokens from a model with no price.')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Shop/ }))
    expect(screen.queryByText(/Leaves out tokens/)).not.toBeInTheDocument()
  })

  it('marks an estimate that leaves out a model with no price', async () => {
    show(one([{ week: thisWeek, usage: [opus(100), free(5)], workMs: 0 }]))
    expect(
      await screen.findByText('* Leaves out tokens from a model with no price.')
    ).toBeInTheDocument()
    expect(screen.getAllByText('(leaves out a model with no price)').length).toBeGreaterThan(0)
  })

  it('has no note when every model has a price', async () => {
    show(usage)
    await screen.findByRole('button', { name: /^All projects/ })
    expect(screen.queryByText(/Leaves out tokens/)).not.toBeInTheDocument()
  })

  it('says when there is no use yet', async () => {
    show({ all: [], projects: [], merged: [] })
    expect(await screen.findByText('No token use yet')).toBeInTheDocument()
  })

  it('shows a failed read', async () => {
    show(new Error('disk on fire'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't read token use: disk on fire"
    )
  })

  it('goes back to All projects when the selected project disappears', async () => {
    const api = fakeSandtable()
    vi.mocked(api.projects.usage).mockResolvedValue(usage)
    const { rerender } = render(<UsagePage projects={projects} onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: /^Shop/ }))
    rerender(<UsagePage projects={projects.slice(1)} onBack={() => {}} />)
    expect(screen.getByRole('button', { name: /^All projects/ })).toHaveAttribute(
      'aria-current',
      'true'
    )
  })
})
