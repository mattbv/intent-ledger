import type { Confidence, Entry, Footprint, Kind, Meta, Moment, Source, Status, Tone, Turn, View } from '../types'

export const SCHEMA_VERSION = 1
export const PLUGIN = 'intent-ledger'
export const TOOL_NAME = 'ledger'
export const TOOL = 'mcp__intent-ledger__ledger'

export const KINDS: readonly Kind[] = ['goal', 'assumption', 'step', 'decision', 'question', 'risk', 'finding']
export const STATUSES: readonly Status[] = ['open', 'active', 'done', 'confirmed', 'invalidated', 'answered', 'dropped']
export const CONFIDENCES: readonly Confidence[] = ['low', 'medium', 'high']

const PREFIX: Record<Kind, string> = { goal: 'G', assumption: 'A', step: 'S', decision: 'D', question: 'Q', risk: 'R', finding: 'F' }

/** The statuses each kind can take; the first is where a new entry starts. */
export const ALLOWED: Record<Kind, readonly Status[]> = {
  goal: ['active', 'done', 'dropped'],
  assumption: ['open', 'confirmed', 'invalidated', 'dropped'],
  step: ['open', 'active', 'done', 'dropped'],
  decision: ['open', 'dropped'],
  question: ['open', 'answered', 'dropped'],
  risk: ['open', 'dropped'],
  finding: ['open', 'dropped'],
}

/** Where a new entry of a kind starts. */
export function startOf(kind: Kind): Status {
  return ALLOWED[kind][0] ?? 'open'
}

export const DEFAULT_META: Meta = { schemaVersion: SCHEMA_VERSION, seq: { goal: 0, assumption: 0, step: 0, decision: 0, question: 0, risk: 0, finding: 0 } }
export const DEFAULT_TURN: Turn = { n: 0, startedAt: 0, logged: 0, edits: [], isRunning: false }
export const DEFAULT_FOOTPRINT: Footprint = { files: [], unloggedTurns: [] }
export const DEFAULT_VIEW: View = { expanded: null }

export const MAX_TEXT = 200
export const MAX_ENTRIES = 300
export const MAX_TIMELINE = 120

// ---------------------------------------------------------------- config

export type Config = {
  instructAgent: boolean
  autoAllow: boolean
  observePlans: boolean
  staleAfterTurns: number
  openOnStart: boolean
  statusLine: boolean
}

export function parseConfig(options: Record<string, unknown> | undefined): Config {
  const o = options ?? {}
  const bool = (k: string, d: boolean) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d)
  const stale = typeof o.staleAfterTurns === 'number' && Number.isFinite(o.staleAfterTurns) ? Math.max(0, Math.round(o.staleAfterTurns)) : 3
  return {
    instructAgent: bool('instructAgent', true),
    autoAllow: bool('autoAllow', true),
    observePlans: bool('observePlans', true),
    staleAfterTurns: stale,
    openOnStart: bool('openOnStart', true),
    statusLine: bool('statusLine', true),
  }
}

// ---------------------------------------------------------------- reading stored values

export function listOf<T>(x: unknown): T[] {
  return Array.isArray(x) ? (x as T[]) : []
}

/** A stored value merged over its defaults, so a shape saved by an older build still reads. */
export function normalize<T extends object>(defaults: T, x: unknown): T {
  return x && typeof x === 'object' && !Array.isArray(x) ? { ...defaults, ...(x as Partial<T>) } : defaults
}

export function normalizeMeta(x: unknown): Meta {
  const m = normalize(DEFAULT_META, x)
  return { schemaVersion: m.schemaVersion, seq: normalize(DEFAULT_META.seq, m.seq) }
}

export function normalizeEntry(x: unknown): Entry | null {
  if (!x || typeof x !== 'object') return null
  const e = x as Partial<Entry>
  if (typeof e.id !== 'string' || !KINDS.includes(e.kind as Kind) || typeof e.text !== 'string') return null
  const kind = e.kind as Kind
  return {
    id: e.id,
    kind,
    text: e.text,
    why: typeof e.why === 'string' ? e.why : '',
    confidence: CONFIDENCES.includes(e.confidence as Confidence) ? (e.confidence as Confidence) : null,
    status: ALLOWED[kind].includes(e.status as Status) ? (e.status as Status) : startOf(kind),
    source: e.source === 'observed' || e.source === 'you' ? e.source : 'agent',
    who: typeof e.who === 'string' ? e.who : 'main',
    turn: typeof e.turn === 'number' ? e.turn : 0,
    at: typeof e.at === 'number' ? e.at : 0,
    updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : 0,
    note: typeof e.note === 'string' ? e.note : '',
    resolvedBy: e.resolvedBy === 'agent' || e.resolvedBy === 'you' || e.resolvedBy === 'observed' ? e.resolvedBy : null,
    ref: typeof e.ref === 'string' ? e.ref : null,
    of: typeof e.of === 'string' && e.of !== e.id ? e.of : null,
  }
}

export function normalizeEntries(x: unknown): Entry[] {
  return listOf<unknown>(x)
    .map(normalizeEntry)
    .filter((e): e is Entry => e !== null)
}

export function normalizeTimeline(x: unknown): Moment[] {
  return listOf<Moment>(x).filter(m => m && typeof m.text === 'string' && typeof m.at === 'number')
}

export function normalizeTurn(x: unknown): Turn {
  const t = normalize(DEFAULT_TURN, x)
  return { ...t, edits: listOf<string>(t.edits) }
}

export function normalizeFootprint(x: unknown): Footprint {
  const f = normalize(DEFAULT_FOOTPRINT, x)
  return { files: listOf<string>(f.files), unloggedTurns: listOf<number>(f.unloggedTurns) }
}

// ---------------------------------------------------------------- text

export function clean(s: unknown, max = MAX_TEXT): string {
  if (typeof s !== 'string') return ''
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}

export function shorten(s: string, n: number): string {
  if (n <= 1) return s.length > 0 ? '…' : ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${String(m % 60).padStart(2, '0')}`
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

// ---------------------------------------------------------------- the ledger tool's input

export type AddItem = { kind: Kind; text: string; why: string; confidence: Confidence | null; of: string | null }
export type ResolveItem = { id: string; status: Status; note: string }
export type ParsedCall = { add: AddItem[]; resolve: ResolveItem[]; problems: string[] }

export const TOOL_DESCRIPTION = [
  'Record your intent in the ledger the user watches in a side pane: your goal, the assumptions you are acting on,',
  'your planned steps, decisions between alternatives, open questions, risks and findings (facts you learned). One short line per entry; batch several in one call.',
  'Use `resolve` to update an entry by id as you learn: confirm or invalidate an assumption (say what you found in `note`),',
  'mark a step active or done, answer a question, or drop an entry that no longer applies.',
  'The result lists what is still open, including any assumption the user marked in the pane.',
].join(' ')

export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    add: {
      type: 'array',
      description: 'New entries.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...KINDS] },
          text: { type: 'string', description: 'One line, under 200 characters.' },
          why: { type: 'string', description: 'For assumptions, decisions and findings: the evidence or reason, briefly.' },
          confidence: { type: 'string', enum: [...CONFIDENCES], description: 'For assumptions: how sure you are.' },
          of: { type: 'string', description: 'Id of an existing entry this one serves or rests on, e.g. a step of S2, an assumption or decision of S3. Steps default to the goal.' },
        },
        required: ['kind', 'text'],
      },
    },
    resolve: {
      type: 'array',
      description: 'Status changes for existing entries, by id (A1, S3, ...).',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: [...STATUSES] },
          note: { type: 'string', description: 'What you found or why it changed.' },
        },
        required: ['id', 'status'],
      },
    },
  },
} as const

export function parseCall(input: unknown): ParsedCall {
  const x = (input && typeof input === 'object' ? input : {}) as { add?: unknown; resolve?: unknown }
  const problems: string[] = []
  const add: AddItem[] = []
  for (const raw of listOf<Record<string, unknown>>(x.add)) {
    const kind = raw?.kind as Kind
    const text = clean(raw?.text)
    if (!KINDS.includes(kind)) {
      problems.push(`unknown kind "${String(raw?.kind)}"`)
      continue
    }
    if (!text) {
      problems.push(`a ${kind} with no text`)
      continue
    }
    const confidence = CONFIDENCES.includes(raw?.confidence as Confidence) ? (raw.confidence as Confidence) : null
    const of = clean(raw?.of, 12).toUpperCase()
    add.push({ kind, text, why: clean(raw?.why, 300), confidence, of: of || null })
  }
  const resolve: ResolveItem[] = []
  for (const raw of listOf<Record<string, unknown>>(x.resolve)) {
    const id = clean(raw?.id, 12).toUpperCase()
    const status = raw?.status as Status
    if (!id || !STATUSES.includes(status)) {
      problems.push(`resolve needs an id and a status (${STATUSES.join(', ')})`)
      continue
    }
    resolve.push({ id, status, note: clean(raw?.note, 300) })
  }
  if (add.length === 0 && resolve.length === 0 && problems.length === 0) problems.push('nothing to record: pass `add` or `resolve`')
  return { add, resolve, problems }
}

// ---------------------------------------------------------------- reducers

export type Stamp = { at: number; turn: number; who: string; source: Source }

export function nextId(meta: Meta, kind: Kind): { id: string; meta: Meta } {
  const n = (meta.seq[kind] ?? 0) + 1
  return { id: `${PREFIX[kind]}${n}`, meta: { ...meta, seq: { ...meta.seq, [kind]: n } } }
}

/** Status a resolve asks for, fitted to the kind: `done` on an assumption reads as confirmed, and so on. */
export function fitStatus(kind: Kind, status: Status): Status | null {
  if (ALLOWED[kind].includes(status)) return status
  const alias: Partial<Record<Status, Status>> = {
    done: kind === 'assumption' ? 'confirmed' : kind === 'question' ? 'answered' : undefined,
    confirmed: kind === 'step' || kind === 'goal' ? 'done' : kind === 'question' ? 'answered' : undefined,
    answered: kind === 'assumption' ? 'confirmed' : kind === 'step' ? 'done' : undefined,
    open: kind === 'goal' ? 'active' : undefined,
    active: kind === 'assumption' || kind === 'question' ? 'open' : undefined,
    invalidated: kind !== 'assumption' ? 'dropped' : undefined,
  }
  return alias[status] ?? null
}

export type Applied = {
  meta: Meta
  entries: Entry[]
  added: Entry[]
  changed: { entry: Entry; from: Status }[]
  problems: string[]
}

export function applyCall(meta: Meta, entries: Entry[], call: ParsedCall, stamp: Stamp): Applied {
  let m = meta
  let list = [...entries]
  const added: Entry[] = []
  const changed: { entry: Entry; from: Status }[] = []
  const problems = [...call.problems]

  for (const item of call.add) {
    // The same open text logged twice is one entry.
    const dup = list.find(e => e.kind === item.kind && e.text === item.text && e.status !== 'dropped')
    if (dup) continue
    const next = nextId(m, item.kind)
    m = next.meta
    const entry: Entry = {
      id: next.id,
      kind: item.kind,
      text: item.text,
      why: item.why,
      confidence: item.kind === 'assumption' ? item.confidence : null,
      status: startOf(item.kind),
      source: stamp.source,
      who: stamp.who,
      turn: stamp.turn,
      at: stamp.at,
      updatedAt: stamp.at,
      note: '',
      resolvedBy: null,
      ref: null,
      of: null,
    }
    if (item.of) {
      if (list.some(e => e.id === item.of)) entry.of = item.of
      else problems.push(`no entry ${item.of} to link ${next.id} to`)
    }
    list.push(entry)
    added.push(entry)
  }

  for (const r of call.resolve) {
    const i = list.findIndex(e => e.id === r.id)
    if (i < 0) {
      problems.push(`no entry ${r.id}`)
      continue
    }
    const old = list[i]
    if (!old) continue
    const status = fitStatus(old.kind, r.status)
    if (!status) {
      problems.push(`${r.id} is a ${old.kind}; it takes ${ALLOWED[old.kind].join(', ')}`)
      continue
    }
    if (status === old.status && !r.note) continue
    const entry: Entry = { ...old, status, note: r.note || old.note, updatedAt: stamp.at, resolvedBy: stamp.source }
    list[i] = entry
    changed.push({ entry, from: old.status })
  }

  // A newer active goal retires none by itself, but a step only one can be active at a time per agent.
  for (const c of changed) {
    if (c.entry.kind === 'step' && c.entry.status === 'active') {
      list = list.map(e => (e.kind === 'step' && e.status === 'active' && e.id !== c.entry.id && e.who === c.entry.who && e.source === c.entry.source ? { ...e, status: 'open' as Status } : e))
    }
  }

  return { meta: m, entries: trimEntries(list), added, changed, problems }
}

/** Keep the list bounded: drop the oldest settled entries first, never an open one. */
export function trimEntries(list: Entry[]): Entry[] {
  if (list.length <= MAX_ENTRIES) return list
  const settled = new Set(['done', 'confirmed', 'answered', 'dropped'])
  let over = list.length - MAX_ENTRIES
  return list.filter(e => {
    if (over > 0 && settled.has(e.status)) {
      over -= 1
      return false
    }
    return true
  })
}

/** The user's mark from the pane. */
export function markByYou(entries: Entry[], id: string, status: Status, at: number): { entries: Entry[]; entry: Entry | null } {
  let hit: Entry | null = null
  const list = entries.map(e => {
    if (e.id !== id) return e
    const s = fitStatus(e.kind, status)
    if (!s) return e
    hit = { ...e, status: s, updatedAt: at, resolvedBy: 'you' as Source, note: e.note }
    return hit
  })
  return { entries: list, entry: hit }
}

// ---------------------------------------------------------------- observed plans

export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' }

const TODO_STATUS: Record<Todo['status'], Status> = { pending: 'open', in_progress: 'active', completed: 'done' }

/** A TodoWrite replaces the whole list: mirror it as observed steps, dropping todos it no longer holds. */
export function syncTodos(meta: Meta, entries: Entry[], todos: Todo[], stamp: Stamp): { meta: Meta; entries: Entry[]; summary: string | null } {
  let m = meta
  const seen = new Set<string>()
  let list = [...entries]
  let moved = 0
  for (const t of todos) {
    const text = clean(t?.content)
    if (!text) continue
    const ref = `todo:${text}`
    seen.add(ref)
    const status = TODO_STATUS[t.status] ?? 'open'
    const i = list.findIndex(e => e.ref === ref)
    const cur = i >= 0 ? list[i] : undefined
    if (cur) {
      if (cur.status !== status) {
        list[i] = { ...cur, status, updatedAt: stamp.at, resolvedBy: 'observed' }
        moved += 1
      }
      continue
    }
    const next = nextId(m, 'step')
    m = next.meta
    list.push({ id: next.id, kind: 'step', text, why: '', confidence: null, status, source: 'observed', who: stamp.who, turn: stamp.turn, at: stamp.at, updatedAt: stamp.at, note: '', resolvedBy: null, ref, of: null })
    moved += 1
  }
  list = list.map(e =>
    e.ref?.startsWith('todo:') && !seen.has(e.ref) && e.status !== 'dropped' && e.status !== 'done' && e.who === stamp.who
      ? ((moved += 1), { ...e, status: 'dropped' as Status, updatedAt: stamp.at, resolvedBy: 'observed' as Source })
      : e,
  )
  if (moved === 0) return { meta: m, entries: list, summary: null }
  const steps = list.filter(e => e.ref?.startsWith('todo:') && e.who === stamp.who && e.status !== 'dropped')
  const done = steps.filter(e => e.status === 'done').length
  return { meta: m, entries: list, summary: `todo list updated · ${done}/${steps.length} done` }
}

export function addTask(meta: Meta, entries: Entry[], taskId: string, subject: string, stamp: Stamp): { meta: Meta; entries: Entry[] } {
  const ref = `task:${taskId}`
  if (entries.some(e => e.ref === ref)) return { meta, entries }
  const next = nextId(meta, 'step')
  const entry: Entry = { id: next.id, kind: 'step', text: clean(subject), why: '', confidence: null, status: 'open', source: 'observed', who: stamp.who, turn: stamp.turn, at: stamp.at, updatedAt: stamp.at, note: '', resolvedBy: null, ref, of: null }
  return { meta: next.meta, entries: [...entries, entry] }
}

export function updateTask(entries: Entry[], taskId: string, patch: { status?: string; subject?: string }, at: number): Entry[] {
  const ref = `task:${taskId}`
  const status: Status | undefined =
    patch.status === 'pending' ? 'open' : patch.status === 'in_progress' ? 'active' : patch.status === 'completed' ? 'done' : patch.status === 'deleted' ? 'dropped' : undefined
  return entries.map(e =>
    e.ref === ref ? { ...e, status: status ?? e.status, text: patch.subject ? clean(patch.subject) : e.text, updatedAt: at, resolvedBy: status ? ('observed' as Source) : e.resolvedBy } : e,
  )
}

// ---------------------------------------------------------------- reading the ledger

export type Counts = { open: number; confirmed: number; invalidated: number; stale: number; stepsDone: number; steps: number; questions: number; risks: number }

export function isStale(e: Entry, turn: number, after: number): boolean {
  return after > 0 && e.kind === 'assumption' && e.status === 'open' && turn - e.turn >= after
}

export function countsOf(entries: Entry[], turn: number, staleAfter: number): Counts {
  const a = entries.filter(e => e.kind === 'assumption')
  const steps = entries.filter(e => e.kind === 'step' && e.status !== 'dropped')
  return {
    open: a.filter(e => e.status === 'open').length,
    confirmed: a.filter(e => e.status === 'confirmed').length,
    invalidated: a.filter(e => e.status === 'invalidated').length,
    stale: a.filter(e => isStale(e, turn, staleAfter)).length,
    stepsDone: steps.filter(e => e.status === 'done').length,
    steps: steps.length,
    questions: entries.filter(e => e.kind === 'question' && e.status === 'open').length,
    risks: entries.filter(e => e.kind === 'risk' && e.status === 'open').length,
  }
}

export function currentGoal(entries: Entry[]): Entry | null {
  const goals = entries.filter(e => e.kind === 'goal' && e.status === 'active')
  return goals[goals.length - 1] ?? null
}

// ---------------------------------------------------------------- the structure graph

export type GraphNode = { entry: Entry; children: GraphNode[] }

export const GRAPH_MAX_DEPTH = 4

/**
 * The goal's tree: steps hang off the goal (or the step they name in `of`); assumptions, decisions,
 * findings, questions and risks hang off whatever they name in `of`. Entries that name nothing
 * appear only as steps under the goal; the rest stay in their own sections. Dropped entries and
 * everything below them are left out. With no goal, top-level steps are the roots.
 */
export function buildGraph(entries: Entry[]): GraphNode[] {
  const goal = currentGoal(entries)
  const live = entries.filter(e => e.status !== 'dropped' && e.kind !== 'goal')
  const byId = new Map(live.map(e => [e.id, e]))
  const parentOf = (e: Entry): string | null => {
    if (e.of && (byId.has(e.of) || e.of === goal?.id)) return e.of
    return e.kind === 'step' && goal ? goal.id : null
  }
  const kids = new Map<string | null, Entry[]>()
  for (const e of live) {
    const p = parentOf(e)
    if (p === null && e.kind !== 'step') continue
    kids.set(p, [...(kids.get(p) ?? []), e])
  }
  const seen = new Set<string>()
  const grow = (e: Entry, depth: number): GraphNode => {
    seen.add(e.id)
    const children = depth >= GRAPH_MAX_DEPTH ? [] : (kids.get(e.id) ?? []).filter(k => !seen.has(k.id)).map(k => grow(k, depth + 1))
    return { entry: e, children }
  }
  if (goal) return [grow(goal, 0)]
  return (kids.get(null) ?? []).map(e => grow(e, 0))
}

export type GraphLine = { prefix: string; glyph: string; entry: Entry }

const GLYPH_BY_KIND: Record<Kind, string> = { goal: '◎', assumption: '?', step: '·', decision: '◇', question: '?', risk: '!', finding: '•' }

export function graphGlyph(e: Entry): string {
  if (e.kind === 'step') return e.status === 'done' ? '✓' : e.status === 'active' ? '▸' : '·'
  if (e.kind === 'assumption') return e.status === 'confirmed' ? '✓' : e.status === 'invalidated' ? '✗' : '?'
  if (e.kind === 'question' && e.status === 'answered') return '✓'
  return GLYPH_BY_KIND[e.kind]
}

/** The tree flattened to lines, each with its box-drawing prefix, capped at `max` lines. */
export function graphLines(roots: GraphNode[], max = 24): GraphLine[] {
  const out: GraphLine[] = []
  const walk = (n: GraphNode, lead: string, isLast: boolean, isRoot: boolean) => {
    out.push({ prefix: isRoot ? '' : lead + (isLast ? '└─ ' : '├─ '), glyph: graphGlyph(n.entry), entry: n.entry })
    const next = isRoot ? '' : lead + (isLast ? '   ' : '│  ')
    n.children.forEach((c, i) => walk(c, next, i === n.children.length - 1, false))
  }
  roots.forEach(r => walk(r, '', true, true))
  return out.slice(0, max)
}

export function activeStep(entries: Entry[]): Entry | null {
  const s = entries.filter(e => e.kind === 'step' && e.status === 'active')
  return s[s.length - 1] ?? null
}

const ASSUMPTION_ORDER: Record<string, number> = { open: 0, invalidated: 1, confirmed: 2, dropped: 3 }

/** Open first (they need attention), then invalidated, confirmed, dropped; newest first within each. */
export function sortedAssumptions(entries: Entry[]): Entry[] {
  return entries
    .filter(e => e.kind === 'assumption')
    .sort((x, y) => (ASSUMPTION_ORDER[x.status] ?? 9) - (ASSUMPTION_ORDER[y.status] ?? 9) || y.at - x.at)
}

export function statusLine(entries: Entry[], turn: number, staleAfter: number): string | undefined {
  if (entries.length === 0) return undefined
  const c = countsOf(entries, turn, staleAfter)
  const parts = [
    c.open > 0 ? `${c.open} open assumption${c.open === 1 ? '' : 's'}` : null,
    c.stale > 0 ? `${c.stale} stale` : null,
    c.invalidated > 0 ? `${c.invalidated} ✗` : null,
    c.steps > 0 ? `plan ${c.stepsDone}/${c.steps}` : null,
    c.questions > 0 ? `${c.questions} ?` : null,
  ].filter(Boolean)
  return parts.length > 0 ? `ledger · ${parts.join(' · ')}` : undefined
}

/** What the ledger tool answers: what was recorded, and what is still open, so the agent can reconcile. */
export function toolReply(applied: Applied, entries: Entry[]): string {
  const lines: string[] = []
  if (applied.added.length > 0) lines.push(`Logged ${applied.added.map(e => e.id).join(', ')}.`)
  if (applied.changed.length > 0) lines.push(`Updated ${applied.changed.map(c => `${c.entry.id} → ${c.entry.status}`).join(', ')}.`)
  if (applied.problems.length > 0) lines.push(`Not recorded: ${applied.problems.join('; ')}.`)
  const byYou = entries.filter(e => e.resolvedBy === 'you')
  if (byYou.length > 0) lines.push(`Marked by the user in the pane: ${byYou.map(e => `${e.id} ${e.status} ("${shorten(e.text, 60)}")`).join('; ')}.`)
  const open = entries.filter(e => e.kind === 'assumption' && e.status === 'open')
  if (open.length > 0) lines.push(`Open assumptions: ${open.map(e => `${e.id} ${shorten(e.text, 60)}`).join('; ')}.`)
  const steps = entries.filter(e => e.kind === 'step' && e.source === 'agent' && (e.status === 'open' || e.status === 'active'))
  if (steps.length > 0) lines.push(`Steps left: ${steps.map(e => `${e.id}${e.status === 'active' ? '*' : ''}`).join(', ')}.`)
  const qs = entries.filter(e => e.kind === 'question' && e.status === 'open')
  if (qs.length > 0) lines.push(`Open questions: ${qs.map(e => e.id).join(', ')}.`)
  return lines.join('\n') || 'Nothing changed.'
}

export function moment(stamp: { at: number; turn: number; who: string }, text: string, tone: Tone): Moment {
  return { at: stamp.at, turn: stamp.turn, who: stamp.who, text: clean(text, 160), tone }
}

export function addMoments(list: Moment[], add: Moment[]): Moment[] {
  return [...list, ...add].slice(-MAX_TIMELINE)
}

export function momentsFor(applied: Applied, stamp: Stamp): Moment[] {
  const out: Moment[] = []
  for (const e of applied.added) out.push(moment(stamp, `+ ${e.id} ${e.text}`, 'add'))
  for (const c of applied.changed) {
    const note = c.entry.note ? ` — ${c.entry.note}` : ''
    const tone: Tone = c.entry.status === 'invalidated' ? 'warn' : 'resolve'
    out.push(moment(stamp, `${c.entry.id} ${c.from} → ${c.entry.status}${note}`, tone))
  }
  return out
}

// ---------------------------------------------------------------- export

export function toMarkdown(entries: Entry[], plan: { text: string } | null): string {
  const sec = (title: string, kind: Kind) => {
    const list = entries.filter(e => e.kind === kind)
    if (list.length === 0) return ''
    const rows = list.map(e => {
      const why = e.why ? ` — ${e.why}` : ''
      const note = e.note ? ` (${e.note})` : ''
      return `- **${e.id}** [${e.status}] ${e.text}${why}${note} _T${e.turn} · ${e.who}${e.source === 'observed' ? ' · observed' : ''}_`
    })
    return `## ${title}\n\n${rows.join('\n')}\n`
  }
  const parts = [
    '# Intent ledger\n',
    sec('Goals', 'goal'),
    sec('Assumptions', 'assumption'),
    sec('Plan', 'step'),
    sec('Decisions', 'decision'),
    sec('Questions', 'question'),
    sec('Risks', 'risk'),
    sec('Findings', 'finding'),
    plan ? `## Approved plan\n\n${plan.text}\n` : '',
  ]
  return parts.filter(Boolean).join('\n')
}

// ---------------------------------------------------------------- the system prompt section

export const INSTRUCTIONS = [
  '# Intent ledger',
  `The user watches a live ledger of your intent in a side pane. Keep it accurate with the \`${TOOL}\` tool.`,
  '- When you start a task that takes more than a couple of steps, log the goal as you understand it, the assumptions you are acting on (about the code, the environment, or what the user wants) and your planned steps, in one call.',
  '- Log an assumption whenever you are about to act on something you have not verified. Give a brief `why` and a `confidence`.',
  '- Log a decision when you choose between real alternatives, with the reason. Log open questions you are deferring or guessing on, and risks you notice.',
  '- Log a finding when you learn a fact that matters to the task and settles no assumption (a limit, a cause, a surprise), with where you saw it as `why`.',
  '- Resolve entries as you learn: confirm or invalidate assumptions (say what you found in `note`), mark steps active and done, answer questions. If the plan changes, drop the stale steps and add the new ones.',
  '- Steps hang off the goal in the pane\'s structure tree. To show how things relate, pass `of` with the id of an entry from an earlier result: a sub-step of S2, an assumption or decision of the step that rests on it.',
  '- If you keep a todo or task list, the ledger reads it; you need not repeat those steps.',
  '- Batch entries; one short line each. Skip the ledger for one-step requests and plain conversation.',
  '- The ledger is for transparency, not a substitute for asking: when a wrong guess would be costly, ask the user.',
  '- If the user marks an assumption wrong in the pane, the next ledger result tells you; adjust your plan accordingly.',
].join('\n')
