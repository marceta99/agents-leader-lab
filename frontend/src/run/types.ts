// Event + state types for the run viewer. Mirrors docs/contracts.md ("Events", "Run result", Runs endpoints).

export type Cell = [number, number]
export type GoalId = 'square' | 'upside_down' | 'one_zone' | 'touching'
export type GoalsMet = Record<GoalId, boolean>
export type Style = 'directive' | 'non_directive' | 'other'
export type AgentMode = 'idle' | 'walking' | 'carrying' | 'flipping'

export const GOAL_IDS: GoalId[] = ['square', 'upside_down', 'one_zone', 'touching']
/** Anything else an agent has as its goal is custom text the experimenter wrote; the game cannot check it. */
export const isGoalId = (g: string): g is GoalId => (GOAL_IDS as string[]).includes(g)
export const GOAL_TEXT: Record<GoalId, string> = {
  square: 'Arrange the chairs in a square.',
  upside_down: 'Turn all the chairs upside down.',
  one_zone: 'Move all the chairs to one part of the room (one zone).',
  touching: 'Make all the chairs touch each other.',
}
const ZONE_NAMES = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
/** Goal text as the agent read it: one_zone names the run's target zone (older runs: any zone). */
export const goalText = (g: GoalId, zone?: number | null) =>
  g === 'one_zone' && zone != null
    ? `Move all the chairs to zone ${zone} (the ${ZONE_NAMES[zone]} part of the room).`
    : (GOAL_TEXT[g] ?? (g as string))
export const GOAL_SHORT: Record<GoalId, string> = {
  square: 'Square',
  upside_down: 'Upside down',
  one_zone: 'One zone',
  touching: 'Touching',
}
// Same hex as the tokens in index.css / docs/design.md (three.js can't read CSS vars).
export const ZONE_COLORS = ['#e3b341', '#7cc3e6', '#9ccb7a', '#ee9aa2']
export const STYLE_COLORS: Record<Style, string> = {
  directive: '#c2410c',
  non_directive: '#1d6fd1',
  other: '#8a8fa3',
}
// Current names, plus the names older runs used, so their replays keep their colours.
export const AGENT_COLORS: Record<string, string> = {
  Sam: '#e4572e',
  Sky: '#2e86ab',
  Sol: '#8e5cd9',
  Sage: '#17a398',
  Ada: '#e4572e',
  Bo: '#2e86ab',
  Cy: '#8e5cd9',
  Dee: '#17a398',
}

export interface StartAgent {
  name: string
  cell: Cell
  goal: GoalId | GoalId[] // old solo runs: list
  budget: number
  is_leader: boolean
  leader_style: 'free' | 'directive' | 'nondirective' | null
}

export interface RunStartedData {
  layout_no: number
  group: string
  grid: number
  cell_ms: number
  flip_ms: number
  time_limit_ms: number
  know_all_goals: boolean
  target_zone?: number | null // zone the one_zone goal names; missing on older runs
  seed?: number
  min_actions?: number
  agents: StartAgent[]
  chairs: { id: number; cell: Cell; upside_down: boolean }[]
}

export interface RunEndedData {
  reason: string
  solved: boolean
  met: GoalsMet
  duration_ms: number
  completion?: number // 0..1, share of the minimum work done
}

export interface DecisionData {
  agent: string
  n: number
  kind: string
  chair: number | null
  cell: Cell | null
  outcome: string
  reason: string | null
}

interface Ev<K extends string, D> {
  seq: number
  t: number
  type: K
  data: D
}

export type RunEvent =
  | Ev<'run_started', RunStartedData>
  | Ev<'agent_step', { agent: string; from: Cell; to: Cell; dur_ms: number }>
  | Ev<'agent_stopped', { agent: string; cell: Cell; reason: string }>
  | Ev<'chair_taken', { agent: string; chair: number; for: 'move' | 'flip'; budget_left: number }>
  | Ev<'chair_dropped', { agent: string; chair: number; cell: Cell }>
  | Ev<'flip_started', { agent: string; chair: number; dur_ms: number }>
  | Ev<'flip_done', { agent: string; chair: number; upside_down: boolean }>
  | Ev<'message', { agent: string; id: number; text: string }>
  | Ev<'notes', { agent: string; text: string }>
  | Ev<'decision', DecisionData>
  | Ev<'goals', { met: GoalsMet }>
  | Ev<'cost', { usd: number }>
  | Ev<'run_ended', RunEndedData>

export type EventType = RunEvent['type']

// One entry per (message, recipient): an instruction, a prohibition (kind "avoid") or an adopted plan.
// score null = could not be tested (untested_reason says why); 0 = tested or not followed, no influence.
export interface Instruction {
  message_id: number
  from: string
  to: string
  type?: 'instruction' | 'prohibition' | 'plan' // missing on results measured before measure_version 2
  action: { kind: string; chair: number | null; cell: Cell | null } // the one done, when followed
  actions?: { kind: string; chair: number | null; cell: Cell | null }[] // everything asked of this agent
  followed: boolean | null
  p_with: number | null
  p_without: number | null
  score: number | null
  untested_reason?: string | null
}

// runs.result; written by measurement, may be null or partial before that.
export interface RunResult {
  solved?: boolean
  completion?: number
  seed?: number
  duration_ms?: number
  end_reason?: string
  goals_met?: GoalsMet
  leader_agent?: string | null
  richest_agent?: string | null
  leader_is_richest?: boolean | null
  measure_version?: number
  measured_leader?: string | null // at least 1 follower
  measured_leader_strict?: string | null // at least 2 followers
  target_agent?: string | null // told to lead, else the richest agent
  target_share?: number | null // primary outcome; null when nobody influenced anyone
  influence?: Record<string, number>
  influence_received?: Record<string, number>
  influence_share?: Record<string, number | null>
  instructions?: Instruction[]
  styles?: Record<string, Style>
  style_mix?: Record<string, Record<Style, number>>
  invalid_share?: number
  partial?: boolean
  measure_cost_usd?: number
}

// GET /api/runs/{id} and GET /api/public/runs/{token}
export interface RunInfo {
  id: number
  experiment_id: number | null
  experiment_name: string | null
  group: string
  layout_no: number
  status: string
  end_reason: string | null
  cost_usd: number | null
  result: RunResult | null
  share_token?: string | null
  is_owner: boolean
  setup?: RunSetup | null // the experiment's choices (no settings, no user data)
}

export interface RunSetup {
  know_all_goals: boolean
  budget: number[]
  add_leader: boolean
  runs: number | null
  model: string
  leader_prompts: Record<string, string> | null
  goals?: string[] | null // per agent slot: built-in id or custom text; null = the 4 built-in
  agent_prompts?: (string | null)[] | null // per agent slot; null = default
}

// ---- board state produced by the reducer ----

export interface ChatMessage {
  id: number
  agent: string
  text: string
  t: number
}

export interface AgentState {
  name: string
  cell: Cell // last cell reached
  pos: [number, number] // interpolated x, y (grid units)
  goal: GoalId | GoalId[]
  budget: number
  isLeader: boolean
  leaderStyle: StartAgent['leader_style']
  holding: number | null
  mode: AgentMode
  notes: string
  lastDecision: DecisionData | null
}

export interface ChairState {
  id: number
  cell: Cell
  pos: [number, number] // follows the carrying agent
  upsideDown: boolean
  heldBy: string | null
  carried: boolean // held for a move (floats above the agent)
  flip: number | null // 0..1 progress while flipping
}

export interface BoardState {
  t: number
  start: RunStartedData | null
  agents: AgentState[]
  chairs: ChairState[]
  goalsMet: GoalsMet
  messages: ChatMessage[]
  costUsd: number | null
  ended: RunEndedData | null
}
