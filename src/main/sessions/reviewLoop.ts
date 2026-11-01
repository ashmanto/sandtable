import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type {
  AutoReview,
  Finding,
  Project,
  PullRequestState,
  RepoChanges,
  ReviewRound,
  SessionRecord
} from '../../shared/types'
import { AUTO_REVIEW_ROUNDS } from '../../shared/types'
import { anchorLine, findingsMessage } from '../../shared/findings'
import { sessionRepos } from '../../shared/sessions'
import { sessionDraft } from '../../shared/drafts'
import type { Orchestrator, OrchestratorDeps } from '../orchestrator'
import type { PrintRun } from './chat'
import { oneLine, redact, withoutUnsafe } from './claudeLaunch'
import { diffText, parseReview, reviewArgs, reviewPrompt } from './review'
import { typeIntoTmux } from './tmux'
import { promptTyped } from './prompt'
import { messageOf } from '../../shared/errors'

const MAX_ANCHOR_FILE_BYTES = 5_000_000

const sameLines = (a: Finding, b: Finding): boolean =>
  a.worktree === b.worktree && a.path === b.path && a.start === b.start && a.end === b.end

type PrsOf = { worktree: string; prs: PullRequestState[] }[]

type ReviewLoop = Pick<
  Orchestrator,
  | 'findings'
  | 'addFinding'
  | 'updateFinding'
  | 'removeFinding'
  | 'sendFindings'
  | 'review'
  | 'pullRequests'
  | 'addCheck'
  | 'addThread'
  | 'setAutoReview'
> & {
  autoRound(s: SessionRecord): Promise<void>
  autoPrFindings(s: SessionRecord): Promise<void>
  autoOn(s: SessionRecord): boolean
  inRound(sessionId: string): boolean
  leaveRound(sessionId: string): void
  pending(sessionId: string): boolean
}

/** Builds the review loop over the orchestrator's sessions and stored findings. */
export function createReviewLoop(ctx: {
  deps: Pick<OrchestratorDeps, 'tmux' | 'pullRequests' | 'failedLog' | 'draft'>
  now: () => Date
  findings: () => Finding[]
  setFindings: (next: Finding[]) => void
  persist: () => Promise<void>
  changed: (projectId: string) => void
  sessionById: (id: string) => SessionRecord
  projectById: (id: string) => Project
  assertCurrent: (s: SessionRecord) => void
  assertSendable: (s: SessionRecord) => Promise<void>
  sending: Set<string>
  changesOf: (sessionId: string) => Promise<RepoChanges[]>
  labelOf: (ticketKey: string) => string
  printRun: PrintRun
  notifyWaiting: (s: SessionRecord, ticketKey: string, body: string) => void
  entryCount: (sessionId: string) => Promise<number>
  roundStarted: (s: SessionRecord, ticketKey: string) => boolean
  roundEnded: (s: SessionRecord, quiet: boolean) => void
}): ReviewLoop {
  const { deps, now, persist, changed, sessionById, projectById, assertCurrent } = ctx
  const { assertSendable, changesOf, labelOf, printRun, sending } = ctx
  const reviewing = new Set<string>()
  const reviewErrors = new Map<string, string>()
  const autoRunning = new Set<string>()
  const KEPT_ROUNDS = 20
  const inRound = new Set<string>()
  const autoOn = (s: SessionRecord): boolean => {
    try {
      return s.autoReview?.on ?? !!projectById(s.projectId).autoReview
    } catch {
      return false
    }
  }
  const autoOf = (s: SessionRecord): AutoReview => (s.autoReview ??= { rounds: 0 })
  const drafted = async (s: SessionRecord): Promise<boolean> =>
    !!(await deps.draft(sessionDraft(s.id)))
  const quiet = async (s: SessionRecord): Promise<boolean> =>
    s.state === 'needsYou' &&
    !s.capped &&
    autoOn(s) &&
    !(await drafted(s)) &&
    (await deps.tmux.captureTmux(s.tmuxName, true).then(
      (pane) => !promptTyped(pane),
      () => false
    ))

  const findingById = (sessionId: string, id: string): Finding => {
    const f = ctx.findings().find((x) => x.sessionId === sessionId && x.id === id)
    if (!f) throw new Error('Unknown finding')
    return f
  }
  const anchoredToFile = async (f: Finding): Promise<Finding> => {
    if (!f.worktree || !f.path || f.start === undefined || f.anchor === undefined) return f
    const file = join(f.worktree, f.path)
    const info = await lstat(file).catch(() => null)
    const text =
      info?.isFile() && info.size <= MAX_ANCHOR_FILE_BYTES
        ? await readFile(file, 'utf8').catch(() => null)
        : null
    const lines = text?.split(/\r?\n/).map((t, i) => ({ new: i + 1, text: t })) ?? []
    const moved = anchorLine(lines, { start: f.start, end: f.end ?? f.start, anchor: f.anchor })
    return moved ? { ...f, ...moved } : f
  }

  const pullRequestsOf = async (s: SessionRecord): Promise<PrsOf> => {
    const { repos } = projectById(s.projectId)
    const read = await Promise.allSettled(
      s.worktrees.flatMap((worktree) =>
        sessionRepos(repos, { ...s, worktrees: [worktree] }).map(async (r) => ({
          worktree,
          prs: s.branch ? await deps.pullRequests(r.github, s.branch) : []
        }))
      )
    )
    const failed = read.find((r) => r.status === 'rejected')
    if (failed && read.every((r) => r.status === 'rejected')) throw failed.reason
    return read.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  }
  const addPrFinding = async (
    s: SessionRecord,
    source: 'check' | 'thread',
    ref: string,
    checked: boolean,
    read: () => Promise<Omit<Finding, 'id' | 'sessionId' | 'source' | 'ref' | 'checked'>>
  ): Promise<Finding> => {
    const same = (f: Finding): boolean =>
      f.sessionId === s.id && f.source === source && f.ref === ref
    const known = (): Finding | undefined =>
      ctx.findings().find((f) => same(f) && (!checked || source !== 'check' || f.log !== undefined))
    const before = known()
    if (before) return before
    const fields = await read()
    assertCurrent(s)
    if (!checked && !autoOn(s)) throw new Error('Automatic review is off')
    const during = known()
    if (during) return during
    const added: Finding = {
      id: randomUUID(),
      sessionId: s.id,
      source,
      ref,
      ...fields,
      checked
    }
    ctx.setFindings([...ctx.findings().filter((f) => !same(f)), added])
    await persist()
    changed(s.projectId)
    return added
  }

  const reviewOf = async (s: SessionRecord, keepUndecided = false): Promise<Finding[]> => {
    const { ticketKey } = s
    if (!ticketKey) throw new Error('Only a ticket session has a review')
    if (reviewing.has(s.id)) throw new Error('A review is already running')
    projectById(s.projectId)
    reviewing.add(s.id)
    reviewErrors.delete(s.id)
    changed(s.projectId)
    try {
      const changes = await changesOf(s.id)
      const diff = diffText(changes)
      if (!diff) throw new Error(changes.find((c) => c.error)?.error ?? 'No changes to review')
      const stdout = await printRun(
        s.projectId,
        ticketKey,
        'Review',
        s.worktrees[0],
        (id) => reviewArgs(reviewPrompt(diff), id, labelOf(ticketKey), s.worktrees.slice(1)),
        600_000
      )
      assertCurrent(s)
      const parsed = parseReview(stdout, changes)
      const count = (s.reviews?.count ?? 0) + 1
      s.reviews = { count, at: now().toISOString() }
      const proposals: Finding[] = parsed.map((p) => ({
        id: randomUUID(),
        sessionId: s.id,
        source: 'review',
        ...p,
        review: count,
        proposed: true,
        checked: true
      }))
      ctx.setFindings([
        ...ctx
          .findings()
          .filter(
            (f) =>
              f.sessionId !== s.id ||
              !f.proposed ||
              (keepUndecided && !proposals.some((p) => sameLines(p, f)))
          ),
        ...proposals
      ])
      await persist()
      return proposals
    } catch (err) {
      reviewErrors.set(s.id, messageOf(err))
      throw err
    } finally {
      reviewing.delete(s.id)
      changed(s.projectId)
    }
  }

  const sendTo = async (s: SessionRecord, ids: string[], automated = false): Promise<void> => {
    await assertSendable(s)
    if (sending.has(s.id)) throw new Error('Already sending')
    const chosen = ctx
      .findings()
      .filter((f) => f.sessionId === s.id && ids.includes(f.id) && !f.proposed && !f.sentAt)
    if (!chosen.length) return
    sending.add(s.id)
    try {
      const anchored = await Promise.all(chosen.map(anchoredToFile))
      await assertSendable(s)
      if (automated && !(await quiet(s))) return
      await typeIntoTmux(
        deps.tmux,
        s.tmuxName,
        withoutUnsafe(findingsMessage(anchored, s.worktrees.length > 1, automated)),
        () => {
          const sentAt = now().toISOString()
          for (const f of chosen) f.sentAt = sentAt
        }
      )
    } finally {
      sending.delete(s.id)
      if (chosen.some((f) => f.sentAt)) {
        await persist()
        changed(s.projectId)
      }
    }
  }

  const checkTo = async (
    s: SessionRecord,
    repo: string,
    jobId: number,
    name: string,
    checked = true,
    read?: PrsOf
  ): Promise<Finding> =>
    addPrFinding(s, 'check', String(jobId), checked, async () => {
      const found = (read ?? (await pullRequestsOf(s)))
        .flatMap((w) => w.prs)
        .filter((p) => p.repo === repo)
        .flatMap((p) => p.checks.map((check) => ({ check, pr: p })))
        .find(({ check: c }) => c.jobId === jobId && c.name === name && c.state === 'failing')
      if (!found) throw new Error('Not a failing check of this pull request')
      const { check, pr } = found
      try {
        return {
          title: check.name,
          text: 'This check failed. Fix what its failed log shows.',
          log: withoutUnsafe(await deps.failedLog(repo, jobId))
        }
      } catch (err) {
        const why = withoutUnsafe(messageOf(err))
        return {
          title: check.name,
          text: `This check failed. Sandtable couldn't read its log: ${why}. Details: ${withoutUnsafe(check.url ?? pr.url)}`
        }
      }
    })

  const threadTo = async (
    s: SessionRecord,
    repo: string,
    threadId: string,
    checked = true,
    read?: PrsOf
  ): Promise<Finding> =>
    addPrFinding(s, 'thread', threadId, checked, async () => {
      const found = (read ?? (await pullRequestsOf(s))).flatMap(({ worktree, prs }) =>
        prs
          .filter((p) => p.repo === repo)
          .flatMap((p) => p.threads.filter((t) => t.id === threadId).map((t) => ({ worktree, t })))
      )[0]
      if (!found) throw new Error('Not an open thread of this pull request')
      const { worktree, t } = found
      const inside = resolve(worktree, t.path).startsWith(`${worktree}/`)
      const start = t.startLine ?? t.line
      const anchor = inside && start !== null ? (t.anchor ?? undefined) : undefined
      return {
        title: inside ? `${t.author} on ${t.path}` : t.author,
        author: t.author,
        text: t.body.trim() || t.url,
        worktree,
        ...(inside && { path: t.path }),
        ...(inside && start !== null && t.line !== null && { start, end: t.line }),
        ...(anchor !== undefined && { anchor })
      }
    })

  const addingPr = new Set<string>()
  const addPrFindings = async (s: SessionRecord): Promise<void> => {
    const read = await pullRequestsOf(s)
    const prs = read.flatMap((w) => w.prs)
    const add = async (ref: string, read: () => Promise<Finding>): Promise<void> => {
      if (!autoOn(s) || s.autoReview?.added?.includes(ref)) return
      await read()
      const auto = autoOf(s)
      auto.added = [...(auto.added ?? []), ref]
      await persist()
    }
    for (const pr of prs) {
      for (const c of pr.checks)
        if (c.state === 'failing' && c.jobId !== undefined) {
          const jobId = c.jobId
          await add(`check:${jobId}`, () => checkTo(s, pr.repo, jobId, c.name, false, read)).catch(
            () => undefined
          )
        }
      for (const t of pr.threads)
        await add(`thread:${t.id}`, () => threadTo(s, pr.repo, t.id, false, read)).catch(
          () => undefined
        )
    }
  }

  const loop: ReviewLoop = {
    autoOn,
    inRound: (sessionId) => inRound.has(sessionId),
    leaveRound: (sessionId) => void inRound.delete(sessionId),
    pending: (sessionId) => autoRunning.has(sessionId),

    async autoRound(s) {
      const { ticketKey } = s
      if (!autoOn(s) || !ticketKey || s.autoReview?.stopped || autoRunning.has(s.id)) return
      if (s.state !== 'needsYou' || s.capped || reviewing.has(s.id)) return
      autoRunning.add(s.id)
      let round: ReviewRound | undefined
      const endReview = (): void => {
        inRound.delete(s.id)
        if (s.state === 'reviewing') s.state = 'needsYou'
      }
      try {
        await assertSendable(s)
        if (await drafted(s)) return
        if (!(await pullRequestsOf(s)).some((w) => w.prs.length)) return
        const changes = await changesOf(s.id)
        if (!diffText(changes)) return
        const hash = createHash('sha256').update(JSON.stringify(changes)).digest('hex')
        const auto = autoOf(s)
        if (auto.reviewed === hash || reviewing.has(s.id)) return
        const at = await ctx.entryCount(s.id).catch(() => undefined)
        if (reviewing.has(s.id)) return
        round = {
          ...(at !== undefined && { at }),
          round: auto.rounds + 1,
          startedAt: now().toISOString(),
          files: changes.reduce((n, c) => n + c.files.length, 0)
        }
        s.reviewRounds = [...(s.reviewRounds ?? []), round].slice(-KEPT_ROUNDS)
        const review = reviewOf(s, true).finally(endReview)
        review.catch(() => undefined)
        if (ctx.roundStarted(s, ticketKey)) inRound.add(s.id)
        void persist().catch(() => undefined)
        changed(s.projectId)
        const proposals = await review
        round.found = proposals.length
        if (!autoOn(s) || s.autoReview !== auto) {
          round.error = autoOn(s)
            ? 'Automatic review was turned off and on again.'
            : 'Automatic review was turned off.'
          return
        }
        auto.rounds += 1
        auto.reviewed = hash
        const mine = (): Finding[] => ctx.findings().filter((f) => f.sessionId === s.id)
        const high = proposals.filter((f) => f.severity === 'high')
        for (const f of high) delete f.proposed
        if (!high.length) auto.stopped = 'clean'
        else if (auto.rounds >= AUTO_REVIEW_ROUNDS) auto.stopped = 'rounds'
        await persist()
        changed(s.projectId)
        const ids = high.map((f) => f.id)
        if (ids.length && (await quiet(s))) await sendTo(s, ids, true).catch(() => undefined)
        round.sent = high.filter((f) => f.sentAt).length
        const waiting = mine().filter(
          (f) => f.proposed || (f.source === 'review' && f.severity === 'high' && !f.sentAt)
        ).length
        round.waiting = waiting
        if (waiting)
          ctx.notifyWaiting(
            s,
            ticketKey,
            `${waiting} review ${waiting === 1 ? 'proposal' : 'proposals'} waiting`
          )
      } catch (err) {
        const why = redact(oneLine(messageOf(err))).replace(/^Review failed: /, '')
        if (round) round.error = `The review failed: ${why}`.slice(0, 300)
      } finally {
        endReview()
        autoRunning.delete(s.id)
        ctx.roundEnded(s, !round || (!round.sent && !round.waiting))
        if (round) {
          round.endedAt = now().toISOString()
          await persist().catch(() => undefined)
          changed(s.projectId)
        }
      }
    },

    async autoPrFindings(s) {
      if (!autoOn(s) || addingPr.has(s.id)) return
      addingPr.add(s.id)
      try {
        await addPrFindings(s)
      } finally {
        addingPr.delete(s.id)
      }
    },

    async setAutoReview(sessionId, on) {
      const s = sessionById(sessionId)
      if (typeof on !== 'boolean') throw new Error('Not a valid setting')
      if (!s.ticketKey) throw new Error('Only a ticket session has a review')
      if (s.removedAt) throw new Error('The worktree was removed')
      const added = s.autoReview?.added
      s.autoReview = on ? { on, rounds: 0, ...(added && { added }) } : { ...autoOf(s), on }
      await persist()
      changed(s.projectId)
    },

    async findings(sessionId) {
      const s = sessionById(sessionId)
      const reviewError = reviewErrors.get(sessionId)
      const auto = autoOn(s) || s.autoReview?.on === false
      return {
        findings: ctx.findings().filter((f) => f.sessionId === sessionId),
        reviewing: reviewing.has(sessionId),
        ...(s.reviews && { reviews: s.reviews }),
        ...(reviewError !== undefined && { reviewError }),
        ...(auto && { auto: s.autoReview ?? { rounds: 0 } }),
        ...(autoRunning.has(sessionId) && reviewing.has(sessionId) && { autoReviewing: true })
      }
    },

    async addFinding(sessionId, f) {
      const s = sessionById(sessionId)
      const text = f.text.trim()
      if (!text) throw new Error('Enter a finding')
      const { source, worktree, path, start, anchor } = f
      const end = f.end ?? start
      const line = (n: unknown): boolean => Number.isInteger(n) && (n as number) > 0
      if (
        source !== 'you' ||
        (start === undefined
          ? f.end !== undefined
          : !line(start) || !line(end) || (end as number) < start)
      )
        throw new Error('Not a valid finding')
      if (worktree !== undefined && !s.worktrees.includes(worktree))
        throw new Error('Not a worktree of this session')
      if (
        path !== undefined &&
        (!worktree || isAbsolute(path) || !resolve(worktree, path).startsWith(`${worktree}/`))
      )
        throw new Error('Not a file in this worktree')
      const added: Finding = {
        id: randomUUID(),
        sessionId,
        source,
        text,
        ...(worktree !== undefined && { worktree }),
        ...(path !== undefined && { path }),
        ...(start !== undefined && { start, end }),
        ...(anchor !== undefined && { anchor }),
        checked: true
      }
      ctx.setFindings([...ctx.findings(), added])
      await persist()
      changed(s.projectId)
      return added
    },

    async updateFinding(sessionId, id, patch) {
      const s = sessionById(sessionId)
      const f = findingById(sessionId, id)
      if (patch.checked !== undefined) f.checked = patch.checked
      if (patch.kept) delete f.proposed
      await persist()
      changed(s.projectId)
    },

    async removeFinding(sessionId, id) {
      const s = sessionById(sessionId)
      const f = ctx.findings().find((x) => x.sessionId === sessionId && x.id === id)
      if (!f) return
      ctx.setFindings(ctx.findings().filter((x) => x !== f))
      await persist()
      changed(s.projectId)
    },

    async review(sessionId) {
      return (await reviewOf(sessionById(sessionId))).length
    },

    async sendFindings(sessionId, ids) {
      await sendTo(sessionById(sessionId), ids)
    },

    async addCheck(sessionId, repo, jobId, name) {
      return checkTo(sessionById(sessionId), repo, jobId, name)
    },

    async addThread(sessionId, repo, threadId) {
      return threadTo(sessionById(sessionId), repo, threadId)
    },

    async pullRequests(sessionId) {
      return (await pullRequestsOf(sessionById(sessionId))).flatMap((w) => w.prs)
    }
  }
  return loop
}
