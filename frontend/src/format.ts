// Small display helpers shared by the experiment pages.

export type ExperimentSummary = {
  id: number
  name: string
  status: string
  created_at: string
  runs_done: number
  runs_total: number
  spent_usd: number
  cap_usd: number
  model: string
  add_leader: boolean
  is_demo: boolean
}

export type RunSummary = {
  id: number
  group: string
  layout_no: number
  status: string
  end_reason: string | null
  solved: boolean | null
  completion: number | null
  seed: number | null
  measured_leader: string | null
  leader_agent: string | null
  rich_agent?: string | null // most actions; null when budgets tie
  cost_usd: number
}

export const MODELS: { id: string; label: string; hint: string; cost: string; blurb: string }[] = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'cheapest', cost: '1×', blurb: 'Fast and cheap. Right for a first look.' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'about 20× the cost of Haiku', cost: '≈20×', blurb: 'Stronger reasoning, about 20 times the cost of Haiku.' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'about 40× the cost of Haiku', cost: '≈40×', blurb: 'The most capable, about 40 times the cost of Haiku.' },
]

export const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id

export const GROUP_LABELS: Record<string, string> = {
  none: 'No leader',
  free: 'Free leader',
  directive: 'Directive leader',
  nondirective: 'Non-directive leader',
}
export const groupLabel = (g: string) => GROUP_LABELS[g] ?? g

// Default leader prompts (backend agents/prompts.py LEADER_LINES); editable per experiment.
export const LEADER_DEFAULTS: Record<string, string> = {
  free: 'You are the leader. Decide how to lead.',
  directive: 'Lead by giving clear instructions to the others.',
  nondirective: 'Lead by asking questions, proposing ideas and summarising, without telling anyone what to do.',
}
export const LEADER_MAX = 1000
// Groups a new leader experiment runs ("none" and "free" exist only in older experiments).
export const LEADER_STYLES = ['directive', 'nondirective']

/** What the leader agent is told in each group: the experiment's own prompts, else the defaults. */
export const leaderText = (g: string, prompts?: Record<string, string> | null) =>
  g === 'none' ? 'Nothing. A normal game, for comparison.' : `"${prompts?.[g] ?? LEADER_DEFAULTS[g] ?? ''}"`

/** Experiment name built from its settings (same rule as the backend's experiment_name). */
export function experimentName(c: { know_all_goals: boolean; budget: number[]; add_leader: boolean }) {
  const b = c.budget
  const budget = new Set(b).size === 1 ? `Equal budget ${b[0]}` : `Budget ${[...b].sort((x, y) => y - x).join('-')}`
  return `${c.know_all_goals ? 'Goals known' : 'Goals hidden'} · ${budget} · ${c.add_leader ? 'Directive vs non-directive leader' : 'No leader'}`
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
  measuring: 'Measuring',
  finished: 'Finished',
  stopped: 'Stopped',
  failed: 'Failed',
}
export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s

// Why an experiment stopped, and what to do about it.
const STOP_REASONS: Record<string, string> = {
  user_stopped: 'You stopped it. Finished runs are kept.',
  cap_reached: 'It reached its spending cap. Finished runs are kept; raise the cap in a new experiment to run more.',
  key_deleted: 'Your API key was deleted. Add a key, then launch a new experiment.',
  invalid_key: 'Anthropic rejected your API key. Replace it on the API key page, then launch a new experiment.',
  out_of_credit: 'Your Anthropic account ran out of credit. Add credit at console.anthropic.com, then launch a new experiment.',
}
export const stopReasonText = (r: string) => STOP_REASONS[r] ?? r.replace(/_/g, ' ')

// Current names, plus the names older runs used.
export const AGENT_COLORS: Record<string, string> = {
  Sam: 'var(--ada)', Sky: 'var(--bo)', Sol: 'var(--cy)', Sage: 'var(--dee)',
  Ada: 'var(--ada)', Bo: 'var(--bo)', Cy: 'var(--cy)', Dee: 'var(--dee)',
}

export const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export function money(usd: number | null | undefined): string {
  if (usd == null) return '—'
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

export const percent = (rate: number | null | undefined) => (rate == null ? '—' : `${Math.round(rate * 100)}%`)

export function duration(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const yesNo = (v: boolean | null | undefined) => (v == null ? '—' : v ? 'Yes' : 'No')

/** Readable message from an api() error; FastAPI 422 details arrive as a JSON list. */
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (!msg.startsWith('[')) return msg
  try {
    return (JSON.parse(msg) as { msg?: string }[]).map((d) => d.msg ?? '').join('; ') || msg
  } catch {
    return msg
  }
}
