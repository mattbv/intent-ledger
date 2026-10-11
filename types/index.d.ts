/** What an entry records. */
export type Kind = 'goal' | 'assumption' | 'step' | 'decision' | 'question' | 'risk' | 'finding'

/**
 * Where an entry stands. Assumptions: open, confirmed, invalidated, dropped.
 * Steps: open, active, done, dropped. Questions: open, answered, dropped.
 * Goals: active, done, dropped. Decisions, risks and findings: open, dropped.
 */
export type Status = 'open' | 'active' | 'done' | 'confirmed' | 'invalidated' | 'answered' | 'dropped'

/** agent: logged through the ledger tool. observed: read off a todo list, task list or plan. you: set from the pane. */
export type Source = 'agent' | 'observed' | 'you'

export type Confidence = 'low' | 'medium' | 'high'

export type Entry = {
  id: string
  kind: Kind
  text: string
  why: string
  confidence: Confidence | null
  status: Status
  source: Source
  /** Who logged it: `main`, or a short subagent label. */
  who: string
  /** The main-loop turn it was logged in. */
  turn: number
  at: number
  updatedAt: number
  /** The latest resolution note, e.g. what invalidated an assumption. */
  note: string
  /** Who last changed its status: `agent`, `you` or `observed`. */
  resolvedBy: Source | null
  /** For observed steps: `todo:<content>` or `task:<id>`. */
  ref: string | null
}

export type Tone = 'info' | 'add' | 'resolve' | 'warn' | 'you'

export type Moment = { at: number; turn: number; who: string; text: string; tone: Tone }

export type Turn = { n: number; startedAt: number; logged: number; edits: string[]; isRunning: boolean }

export type ApprovedPlan = { text: string; at: number; turn: number }

export type Footprint = { files: string[]; unloggedTurns: number[] }

export type View = { expanded: string | null }

export type Meta = { schemaVersion: number; seq: Record<Kind, number> }

declare module 'claude-code' {
  interface PluginState {
    'intent-ledger': {
      meta: Meta
      entries: Entry[]
      timeline: Moment[]
      turn: Turn
      plan: ApprovedPlan | null
      footprint: Footprint
      view: View
    }
  }
}
