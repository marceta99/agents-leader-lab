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
  measured_leader: string | null
  leader_agent: string | null
  cost_usd: number
}

export const MODELS: { id: string; label: string; hint: string }[] = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'cheapest' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'about 20× the cost of Haiku' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'about 40× the cost of Haiku' },
]

export const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id

export const GROUP_LABELS: Record<string, string> = {
  none: 'No leader',
  free: 'Free leader',
  directive: 'Directive leader',
  nondirective: 'Non-directive leader',
  solo: 'Solo baseline',
}
export const groupLabel = (g: string) => GROUP_LABELS[g] ?? g

// What the leader agent is told in each group (contract: "Prompt wording").
export const LEADER_TEXT: Record<string, string> = {
  none: 'Nothing. A normal game, for comparison.',
  free: '"You are the leader. Decide how to lead."',
  directive: '"Lead by giving clear instructions to the others."',
  nondirective: '"Lead by asking questions, proposing ideas and summarising, without telling anyone what to do."',
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  measuring: 'Measuring',
  finished: 'Finished',
  stopped: 'Stopped',
  failed: 'Failed',
}
export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s

export const GOAL_TEXT: Record<string, string> = {
  circle: 'Arrange the chairs in a circle.',
  upside_down: 'Turn all the chairs upside down.',
  one_zone: 'Move all the chairs to one part of the room (one zone).',
  touching: 'Make all the chairs touch each other.',
}

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
