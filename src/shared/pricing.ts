import type { ModelUsage } from './types'

/** One message's token counts, as priced. */
export type MessageUsage = {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
  fast: boolean
}

type Rates = { input: number; cacheRead: number; output: number }
type Model = Rates & { name: string; long?: Rates; fast?: boolean }

const rates = (input: number, cacheRead: number, output: number): Rates => ({
  input,
  cacheRead,
  output
})
const model = (name: string, r: Rates, extra?: Partial<Model>): Model => ({ name, ...r, ...extra })

const FABLE_5_1 = rates(10, 0.25, 50)
const FABLE_5 = rates(10, 1, 50)
const OPUS_5 = rates(5, 0.5, 25)
const OPUS_4 = rates(15, 1.5, 75)
const SONNET_4 = rates(3, 0.3, 15)

// From https://platform.claude.com/docs/en/about-claude/pricing on October 26, 2026, USD per million tokens.
const MODELS: Record<string, Model> = {
  'claude-fable-5-1': model('Fable 5.1', FABLE_5_1),
  'claude-mythos-5-1': model('Mythos 5.1', FABLE_5_1),
  'claude-fable-5': model('Fable 5', FABLE_5),
  'claude-mythos-5': model('Mythos 5', FABLE_5),
  'claude-opus-5-5': model('Opus 5.5', rates(4, 0.2, 20), { fast: true }),
  'claude-opus-5': model('Opus 5', OPUS_5, { fast: true }),
  'claude-opus-4-8': model('Opus 4.8', OPUS_5, { fast: true }),
  'claude-opus-4-7': model('Opus 4.7', OPUS_5),
  'claude-opus-4-6': model('Opus 4.6', OPUS_5),
  'claude-opus-4-5': model('Opus 4.5', OPUS_5),
  'claude-opus-4-1': model('Opus 4.1', OPUS_4),
  'claude-opus-4': model('Opus 4', OPUS_4),
  'claude-sonnet-5-5': model('Sonnet 5.5', rates(2, 0.1, 10)),
  'claude-sonnet-5': model('Sonnet 5', rates(2, 0.2, 10)),
  'claude-sonnet-4-6': model('Sonnet 4.6', SONNET_4),
  'claude-sonnet-4-5': model('Sonnet 4.5', SONNET_4),
  'claude-sonnet-4': model('Sonnet 4', SONNET_4),
  'claude-haiku-5-5': model('Haiku 5.5', rates(0.1, 0.01, 0.5), { long: rates(0.5, 0.05, 2.5) }),
  'claude-haiku-4-5': model('Haiku 4.5', rates(1, 0.1, 5)),
  'claude-3-5-haiku': model('Haiku 3.5', rates(0.8, 0.08, 4))
}
const LONG_PROMPT = 100_000
const FAST_FACTOR = 2

/** The model ID without its date suffix and `[1m]`-style tag, as the price table keys it. */
export const baseModel = (id: string): string => id.replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')

/** The model's display name, or `null` when the price table doesn't know it. */
export const modelName = (id: string): string | null => MODELS[baseModel(id)]?.name ?? null

/** What one message would cost on the API in USD, or `null` when there's no price for it. */
export function messagePrice(id: string, u: MessageUsage): number | null {
  const m = MODELS[baseModel(id)]
  if (!m || (u.fast && !m.fast)) return null
  const prompt = u.input + u.cacheWrite5m + u.cacheWrite1h + u.cacheRead
  const r = m.long && prompt > LONG_PROMPT ? m.long : m
  const dollars =
    u.input * r.input +
    u.cacheWrite5m * r.input * 1.25 +
    u.cacheWrite1h * r.input * 2 +
    u.cacheRead * r.cacheRead +
    u.output * r.output
  return (dollars / 1_000_000) * (u.fast ? FAST_FACTOR : 1)
}

/** One model's tokens of every type. */
export const tokenCount = (u: ModelUsage): number => u.input + u.output + u.cacheWrite + u.cacheRead

/** The choices for a project's Token cap. */
export const TOKEN_CAPS = [10e6, 25e6, 50e6, 100e6, 250e6]

/** The rows summed by model, leaving out models with no tokens, largest first. */
export function mergeUsage(rows: ModelUsage[]): ModelUsage[] {
  const by = new Map<string, ModelUsage>()
  for (const r of rows) {
    const s = by.get(r.model)
    by.set(
      r.model,
      s
        ? {
            ...s,
            input: s.input + r.input,
            output: s.output + r.output,
            cacheWrite: s.cacheWrite + r.cacheWrite,
            cacheRead: s.cacheRead + r.cacheRead,
            price: s.price === null || r.price === null ? null : s.price + r.price
          }
        : r
    )
  }
  return [...by.values()]
    .filter((u) => tokenCount(u) > 0)
    .sort((a, b) => tokenCount(b) - tokenCount(a))
}
