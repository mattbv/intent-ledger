import { DEFAULT_PALETTE_ID, PALETTE_IDS, markOn, paletteOf } from './palettes'
import type { Palette } from './palettes'
import type { Confidence, Entry, Footprint, Kind, Meta, Moment, Source, Status, Tone, Turn, View } from '../types'

export const SCHEMA_VERSION = 1
/** The plugin's version; keep it equal to `version` in `.claude-plugin/plugin.json` (CI checks). */
export const VERSION = '0.4.6'
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

export const DEFAULT_META: Meta = { schemaVersion: SCHEMA_VERSION, seq: { goal: 0, assumption: 0, step: 0, decision: 0, question: 0, risk: 0, finding: 0 }, reportedAt: 0 }
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
  brandAccent: boolean
  palette: string
}

/** What `/ledger status` prints: the version and the settings that decide how the pane looks and behaves. */
export function statusText(cfg: Config): string {
  const on = (b: boolean) => (b ? 'on' : 'off')
  return [
    `Intent Ledger ${VERSION}`,
    `palette: ${cfg.palette}${cfg.palette === DEFAULT_PALETTE_ID ? ` (follows your Claude Code theme; brandAccent ${on(cfg.brandAccent)})` : ''}`,
    `instructAgent ${on(cfg.instructAgent)} · observePlans ${on(cfg.observePlans)} · autoAllow ${on(cfg.autoAllow)} · statusLine ${on(cfg.statusLine)} · openOnStart ${on(cfg.openOnStart)} · stale after ${cfg.staleAfterTurns} turns`,
  ].join('\n')
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
    brandAccent: bool('brandAccent', false),
    palette: typeof o.palette === 'string' && PALETTE_IDS.includes(o.palette.trim().toLowerCase()) ? o.palette.trim().toLowerCase() : DEFAULT_PALETTE_ID,
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
  return { schemaVersion: m.schemaVersion, seq: normalize(DEFAULT_META.seq, m.seq), reportedAt: typeof m.reportedAt === 'number' ? m.reportedAt : 0 }
}

/** Two counters, whichever is further along per kind: writers that each held an older copy still agree. */
export function mergeMeta(a: Meta, b: Meta): Meta {
  const seq = { ...a.seq }
  for (const k of KINDS) seq[k] = Math.max(a.seq[k] ?? 0, b.seq[k] ?? 0)
  return { schemaVersion: Math.max(a.schemaVersion, b.schemaVersion), seq, reportedAt: Math.max(a.reportedAt, b.reportedAt) }
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
    closedTurn: typeof e.closedTurn === 'number' ? e.closedTurn : null,
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

// Control characters, bidi overrides and zero-width marks, lone surrogates, and the two non-characters.
// Agent text can come from untrusted files, and it reaches a terminal and SVG markup.
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

export function stripUnsafe(s: string): string {
  return s.replace(UNSAFE, '')
}

/** `s` cut to `n` code points (never mid-pair), ending in an ellipsis when cut. */
export function clip(s: string, n: number): string {
  const cps = Array.from(s)
  if (cps.length <= n) return s
  return n <= 1 ? (cps.length > 0 ? '…' : '') : `${cps.slice(0, n - 1).join('')}…`
}

export function clean(s: unknown, max = MAX_TEXT): string {
  if (typeof s !== 'string') return ''
  return clip(stripUnsafe(s.replace(/\s+/g, ' ')).trim(), max)
}

export function shorten(s: string, n: number): string {
  return clip(s, n)
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

export type AddItem = { kind: Kind; text: string; why: string; confidence: Confidence | null; of: string | null; pos: number }
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
          of: { type: 'string', description: 'What this entry serves or rests on: the id of an existing entry (a step of S2, an assumption of S3), or "@N" for the Nth entry of this same `add` list, counting from 1 ("@1" is the first). Steps default to the goal.' },
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
  listOf<Record<string, unknown>>(x.add).forEach((raw, index) => {
    const kind = raw?.kind as Kind
    const text = clean(raw?.text)
    if (!KINDS.includes(kind)) {
      problems.push(`unknown kind "${String(raw?.kind)}"`)
      return
    }
    if (!text) {
      problems.push(`a ${kind} with no text`)
      return
    }
    const confidence = CONFIDENCES.includes(raw?.confidence as Confidence) ? (raw.confidence as Confidence) : null
    const of = clean(raw?.of, 12).toUpperCase()
    add.push({ kind, text, why: clean(raw?.why, 300), confidence, of: of || null, pos: index + 1 })
  })
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

/** The next id of a kind. Ids already in `taken` are skipped, so two writers holding the same counter never mint one id twice. */
export function nextId(meta: Meta, kind: Kind, taken: readonly Entry[] = []): { id: string; meta: Meta } {
  const used = new Set(taken.map(e => e.id))
  let n = (meta.seq[kind] ?? 0) + 1
  while (used.has(`${PREFIX[kind]}${n}`)) n += 1
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

  // `of: "@N"` names the Nth entry of this call's `add` list, so a tree can be built in one call.
  const byPos = new Map<number, string>()
  for (const item of call.add) {
    const target = (): string | undefined => {
      const pos = item.of ? /^@(\d+)$/.exec(item.of) : null
      return pos ? byPos.get(Number(pos[1])) : list.find(e => e.id === item.of)?.id
    }
    // The same text logged again while the first is still unsettled, by the same writer, is one entry;
    // a repeat of something already finished is new work. A repeat may still say what it rests on.
    const dup = list.find(e => e.kind === item.kind && e.text === item.text && e.who === stamp.who && !isSettled(e.status))
    if (dup) {
      byPos.set(item.pos, dup.id)
      const to = item.of ? target() : undefined
      if (to && !dup.of && to !== dup.id) list = list.map(e => (e.id === dup.id ? { ...e, of: to } : e))
      continue
    }
    const next = nextId(m, item.kind, list)
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
      closedTurn: null,
    }
    if (item.of) {
      const to = target()
      if (to && to !== entry.id) entry.of = to
      else problems.push(`no entry ${item.of} to link ${next.id} to`)
    }
    byPos.set(item.pos, entry.id)
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
      problems.push(`${r.id} is ${/^[aeiou]/.test(old.kind) ? 'an' : 'a'} ${old.kind}; it takes ${ALLOWED[old.kind].join(', ')}`)
      continue
    }
    if (status === old.status && !r.note) continue
    const entry: Entry = { ...old, status, note: r.note || old.note, updatedAt: stamp.at, resolvedBy: stamp.source }
    list[i] = entry
    changed.push({ entry, from: old.status })
  }

  // Only one step can be active at a time per agent: activating one sets the others back to open.
  for (const c of changed) {
    if (c.entry.kind === 'step' && c.entry.status === 'active') {
      list = list.map(e => (e.kind === 'step' && e.status === 'active' && e.id !== c.entry.id && e.who === c.entry.who && e.source === c.entry.source ? { ...e, status: 'open' as Status } : e))
    }
  }

  return { meta: m, entries: trimEntries(list), added, changed, problems }
}

/** Hard ceiling: past this, even open entries go, oldest first. */
export const HARD_MAX_ENTRIES = MAX_ENTRIES + 100

/**
 * Keep the list bounded. Settled entries go first, oldest first, those nothing links to before those
 * something does (their children are re-parented, not orphaned); the current goal is never dropped.
 * Open entries only go past the hard ceiling, so the list cannot grow without bound.
 */
export function trimEntries(list: Entry[]): Entry[] {
  if (list.length <= MAX_ENTRIES) return list
  let out = list
  const goal = currentGoal(list)
  const drop = (victim: Entry) => {
    out = out.filter(e => e.id !== victim.id).map(e => (e.of === victim.id ? { ...e, of: victim.of } : e))
  }
  const linked = () => new Set(out.map(e => e.of).filter((x): x is string => x !== null))
  for (const pass of ['leaf', 'any'] as const) {
    for (const e of [...out]) {
      if (out.length <= MAX_ENTRIES) return out
      if (!isSettled(e.status) || e.id === goal?.id) continue
      if (pass === 'leaf' && linked().has(e.id)) continue
      drop(e)
    }
  }
  for (const e of [...out]) {
    if (out.length <= HARD_MAX_ENTRIES) break
    if (e.id !== goal?.id) drop(e)
  }
  return out
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
    const i = list.findIndex(e => e.ref === ref && e.who === stamp.who)
    const cur = i >= 0 ? list[i] : undefined
    if (cur) {
      if (cur.status !== status) {
        list[i] = { ...cur, status, updatedAt: stamp.at, resolvedBy: 'observed' }
        moved += 1
      }
      continue
    }
    const next = nextId(m, 'step', list)
    m = next.meta
    list.push({ id: next.id, kind: 'step', text, why: '', confidence: null, status, source: 'observed', who: stamp.who, turn: stamp.turn, at: stamp.at, updatedAt: stamp.at, note: '', resolvedBy: null, ref, of: null, closedTurn: null })
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
  const next = nextId(meta, 'step', entries)
  const entry: Entry = { id: next.id, kind: 'step', text: clean(subject), why: '', confidence: null, status: 'open', source: 'observed', who: stamp.who, turn: stamp.turn, at: stamp.at, updatedAt: stamp.at, note: '', resolvedBy: null, ref, of: null, closedTurn: null }
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

// ---------------------------------------------------------------- small visuals

/** `▰▰▱▱▱`: `done` of `total`, never full until it is, never empty once something is done. */
export function progressBar(done: number, total: number, width = 8): string {
  if (total <= 0) return ''
  const raw = Math.round((Math.max(0, done) / total) * width)
  const filled = done >= total ? width : Math.max(done > 0 ? 1 : 0, Math.min(width - 1, raw))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

/** `▁▃█`: one block per value, scaled to the largest; a zero is a dot. */
export function sparkline(values: number[]): string {
  const max = Math.max(0, ...values)
  const blocks = '▁▂▃▄▅▆▇█'
  return values.map(v => (v <= 0 || max <= 0 ? '·' : blocks[Math.min(7, Math.ceil((v / max) * 8) - 1)]!)).join('')
}

/** How much happened per turn: entries logged plus entries settled in it. */
export function activityByTurn(entries: Entry[], turns: number[]): number[] {
  return turns.map(t => entries.filter(e => e.turn === t).length + entries.filter(e => e.closedTurn === t).length)
}

/** 0 young, 1 close to going stale, 2 stale (or `after` is 0 and nothing ever goes stale: 0). */
export function ageLevel(age: number, after: number): 0 | 1 | 2 {
  if (after <= 0) return 0
  if (age >= after) return 2
  return age >= Math.ceil((after * 2) / 3) ? 1 : 0
}

/** Touched since the current turn started: added or changed since your last prompt. */
export function isFresh(e: Entry, turn: Turn): boolean {
  return turn.n > 0 && turn.startedAt > 0 && e.updatedAt >= turn.startedAt
}

export type HealthPart = { text: string; tone: 'warning' | 'error' | 'success' | 'plain' }

/** The one-line summary at the top of the pane; only what is non-zero. */
export function healthParts(c: Counts): HealthPart[] {
  const parts: HealthPart[] = []
  if (c.open > 0) parts.push({ text: `${c.open} open`, tone: 'warning' })
  if (c.stale > 0) parts.push({ text: `⚠ ${c.stale} stale`, tone: 'warning' })
  if (c.invalidated > 0) parts.push({ text: `✗ ${c.invalidated}`, tone: 'error' })
  if (c.confirmed > 0) parts.push({ text: `✓ ${c.confirmed}`, tone: 'success' })
  if (c.steps > 0) parts.push({ text: `${progressBar(c.stepsDone, c.steps)} ${c.stepsDone}/${c.steps}`, tone: c.stepsDone === c.steps ? 'success' : 'plain' })
  if (c.questions > 0) parts.push({ text: `? ${c.questions}`, tone: 'warning' })
  if (c.risks > 0) parts.push({ text: `! ${c.risks}`, tone: 'error' })
  return parts
}

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

/** Colours for the terminal text: Claude Code's theme keys, or the palette's hex when one is chosen. */
export type TermColors = { accent: string | undefined; success: string; error: string; warning: string; suggestion: string; subtle: string; inactive: string; planMode: string }

export function termColors(pal: Palette, brandAccent: boolean): TermColors {
  if (!pal.themed) {
    return { accent: brandAccent ? 'claude' : undefined, success: 'success', error: 'error', warning: 'warning', suggestion: 'suggestion', subtle: 'subtle', inactive: 'inactive', planMode: 'planMode' }
  }
  return { accent: pal.accent, success: pal.ok, error: pal.bad, warning: pal.warn, suggestion: pal.active, subtle: pal.dim, inactive: pal.off, planMode: pal.accent }
}

/**
 * A node of the structure tree. `touched` lists the invalidated assumptions it sits under or above
 * (so a wrong assumption's reach is visible), `onDamage` marks the path to one, `onPath` the path to
 * an active step, and `hidden` how many finished descendants were folded into it.
 */
export type GraphNode = { entry: Entry; children: GraphNode[]; touched: string[]; onDamage: boolean; onPath: boolean; hidden: number }

export const GRAPH_MAX_DEPTH = 4

/** Above this many nodes, fully finished branches fold into one line. */
export const GRAPH_COLLAPSE_AT = 12

/** The most nodes drawn; past it, the least important leaves fold into their parent's `(+n)`. */
export const GRAPH_MAX_NODES = 30

/**
 * The goal's tree: steps hang off the goal (or the step they name in `of`); assumptions, decisions,
 * findings, questions and risks hang off whatever they name in `of`. Entries that name nothing
 * appear only as steps under the goal; the rest stay in their own sections. Dropped entries and
 * everything below them are left out. With no goal, top-level steps are the roots.
 */
export function buildGraph(entries: Entry[], collapse = true): GraphNode[] {
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
    return { entry: e, children, touched: [], onDamage: false, onPath: false, hidden: 0 }
  }
  const roots = goal ? [grow(goal, 0)] : (kids.get(null) ?? []).map(e => grow(e, 0))

  // Invalidated assumptions: everything under one rests on it, and everything above it holds it.
  const decorate = (n: GraphNode, above: string[]): string[] => {
    const here = n.entry.kind === 'assumption' && n.entry.status === 'invalidated' ? [n.entry.id] : []
    const below: string[] = []
    for (const c of n.children) below.push(...decorate(c, [...above, ...here]))
    n.touched = n.entry.kind === 'goal' ? [] : [...new Set([...above, ...below])]
    n.onDamage = here.length > 0 || below.length > 0
    return [...here, ...below]
  }
  const markPath = (n: GraphNode): boolean => {
    const hits = n.children.map(markPath)
    n.onPath = (n.entry.kind === 'step' && n.entry.status === 'active') || hits.some(Boolean)
    return n.onPath
  }
  roots.forEach(r => {
    decorate(r, [])
    markPath(r)
  })

  const count = (n: GraphNode): number => 1 + n.children.reduce((a, c) => a + count(c), 0)
  const settledBelow = (n: GraphNode): boolean => n.children.every(c => isSettled(c.entry.status) && c.entry.status !== 'invalidated' && settledBelow(c))
  const fold = (n: GraphNode) => {
    if (n.entry.kind === 'step' && n.entry.status === 'done' && !n.onPath && !n.onDamage && n.touched.length === 0 && n.children.length > 0 && settledBelow(n)) {
      n.hidden = count(n) - 1
      n.children = []
      return
    }
    n.children.forEach(fold)
  }
  if (collapse && roots.reduce((a, r) => a + count(r), 0) > GRAPH_COLLAPSE_AT) roots.forEach(fold)
  if (collapse) limitTree(roots, GRAPH_MAX_NODES)
  return roots
}

/**
 * Trim a tree to `max` nodes by folding leaves into their parent's `hidden` count, last first, leaving
 * the path to the active step and the path to an invalidated assumption for last.
 */
export function limitTree(roots: GraphNode[], max: number): void {
  const flat = (): { node: GraphNode; parent: GraphNode | null }[] => {
    const out: { node: GraphNode; parent: GraphNode | null }[] = []
    const walk = (n: GraphNode, parent: GraphNode | null) => {
      out.push({ node: n, parent })
      n.children.forEach(c => walk(c, n))
    }
    roots.forEach(r => walk(r, null))
    return out
  }
  for (let all = flat(); all.length > max; all = flat()) {
    const leaves = all.filter(x => x.parent !== null && x.node.children.length === 0 && !x.node.onPath)
    const pick = [...leaves].reverse().find(x => !x.node.onDamage) ?? leaves[leaves.length - 1]
    if (!pick || !pick.parent) return
    pick.parent.children = pick.parent.children.filter(c => c !== pick.node)
    pick.parent.hidden += 1 + pick.node.hidden
  }
}

/** Live entries with no route up to the goal: the agent did not link them to anything. Depth caps and folds do not count. */
export function unlinkedCount(entries: Entry[]): number {
  const goal = currentGoal(entries)
  const live = entries.filter(e => e.kind !== 'goal' && e.status !== 'dropped')
  const byId = new Map(live.map(e => [e.id, e]))
  const linked = (e: Entry, seen: Set<string>): boolean => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    if (e.of && e.of === goal?.id) return true
    const parent = e.of ? byId.get(e.of) : undefined
    return parent ? linked(parent, seen) : e.kind === 'step'
  }
  return live.filter(e => !linked(e, new Set())).length
}

/** `⚠A1,A2` for a node touched by invalidated assumptions (two shown, then `+`), or ''. */
export function touchedTag(ids: string[]): string {
  return ids.length === 0 ? '' : `⚠${ids.slice(0, 2).join(',')}${ids.length > 2 ? '+' : ''}`
}

/** The marker glyph in the SVG: like the text one, but an open step is a ring and a finding an `i`, which read at that size. */
export function svgGlyph(e: Entry): string {
  if (e.kind === 'step' && e.status === 'open') return '○'
  if (e.kind === 'finding') return 'i'
  return graphGlyph(e)
}

export type GraphLine = { prefix: string; glyph: string; entry: Entry; tag: string; onPath: boolean; hidden: number }

const GLYPH_BY_KIND: Record<Kind, string> = { goal: '◎', assumption: '?', step: '·', decision: '◇', question: '?', risk: '!', finding: '•' }

export function graphGlyph(e: Entry): string {
  if (e.kind === 'step') return e.status === 'done' ? '✓' : e.status === 'active' ? '▸' : '·'
  if (e.kind === 'assumption') return e.status === 'confirmed' ? '✓' : e.status === 'invalidated' ? '✗' : '?'
  if (e.kind === 'question' && e.status === 'answered') return '✓'
  return GLYPH_BY_KIND[e.kind]
}

/** The tree flattened to lines, each with its box-drawing prefix, capped at `max` lines. */
export function graphLines(roots: GraphNode[], max = GRAPH_MAX_NODES): GraphLine[] {
  const out: GraphLine[] = []
  const walk = (n: GraphNode, lead: string, isLast: boolean, isRoot: boolean) => {
    out.push({ prefix: isRoot ? '' : lead + (isLast ? '└─ ' : '├─ '), glyph: graphGlyph(n.entry), entry: n.entry, tag: touchedTag(n.touched), onPath: n.onPath, hidden: n.hidden })
    const next = isRoot ? '' : lead + (isLast ? '   ' : '│  ')
    n.children.forEach((c, i) => walk(c, next, i === n.children.length - 1, false))
  }
  roots.forEach(r => walk(r, '', true, true))
  return out.slice(0, max)
}

// ---------------------------------------------------------------- execution over time

const SETTLED: ReadonlySet<Status> = new Set(['done', 'confirmed', 'invalidated', 'answered', 'dropped'])

export function isSettled(status: Status): boolean {
  return SETTLED.has(status)
}

/** Stamp the turn an entry settled in, and clear it when one is reopened. `next` is `prev` after a reducer ran. */
export function withClosedTurns(prev: Entry[], next: Entry[], turn: number): Entry[] {
  const before = new Map(prev.map(e => [e.id, e]))
  return next.map(e => {
    const was = before.get(e.id)
    if (!isSettled(e.status)) return e.closedTurn === null ? e : { ...e, closedTurn: null }
    if (was && was.status === e.status) return e
    return { ...e, closedTurn: turn }
  })
}

export type HistoryRow = { entry: Entry; cells: string[] }
export type History = { turns: number[]; rows: HistoryRow[] }

export const HISTORY_CELL = 3

/** The glyph an entry ends on: settled well, wrong, or dropped. */
export function endGlyph(status: Status): string {
  return status === 'invalidated' ? '✗' : status === 'dropped' ? '×' : '✓'
}

/**
 * A grid of entries (rows) against turns (columns): `○` the turn it was logged, `───` while it stayed
 * open, `✓` `✗` `×` the turn it settled. The last `maxTurns` turns and the last `maxRows` entries show.
 */
export function buildHistory(entries: Entry[], currentTurn: number, maxTurns = 12, maxRows = 14): History {
  const rows = entries.filter(e => e.kind !== 'goal')
  const last = Math.max(currentTurn, ...rows.map(e => e.turn), 1)
  const first = Math.max(1, last - Math.max(1, maxTurns) + 1)
  const turns: number[] = []
  for (let t = first; t <= last; t++) turns.push(t)
  const pad = (s: string) => ` ${s} `.slice(0, HISTORY_CELL).padEnd(HISTORY_CELL)
  const cell = (e: Entry, t: number): string => {
    const born = Math.max(e.turn, 1)
    const end = isSettled(e.status) ? Math.max(e.closedTurn ?? born, born) : null
    if (t < born || (end !== null && t > end)) return ' '.repeat(HISTORY_CELL)
    if (end !== null && t === end) return pad(endGlyph(e.status))
    if (t === born) return pad('○')
    return '─'.repeat(HISTORY_CELL)
  }
  const shown = rows.filter(e => (isSettled(e.status) ? Math.max(e.closedTurn ?? e.turn, e.turn) : last) >= first).slice(-maxRows)
  return { turns, rows: shown.map(entry => ({ entry, cells: turns.map(t => cell(entry, t)) })) }
}

/** `text` cut or padded to exactly `width` cells. */
export function fitText(text: string, width: number): string {
  if (width <= 0) return ''
  const cut = clip(text, width)
  return cut.padEnd(width + (cut.length - Array.from(cut).length))
}

// ---------------------------------------------------------------- SVG for the remote surfaces

/** Escape text for SVG/XML. */
export function esc(text: string): string {
  return stripUnsafe(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Each SVG carries its own dark card, so contrast never depends on how a surface themes or scales it.
const svgStyle = (p: Palette) =>
  `<style>.t{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;fill:${p.text}}.d{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;fill:${p.dim}}.e{stroke:${p.edge};fill:none;stroke-width:1.2}.eb{stroke:${p.bad};fill:none;stroke-width:1.8}</style>`

const svgCard = (width: number, height: number, p: Palette) => `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="8" fill="${p.bg}" stroke="${p.border}"/>`

// Marker glyphs sit on the status colours in the palette's own background colour, so a status never rests on colour alone.

function statusColor(status: Status, p: Palette): string {
  if (status === 'done' || status === 'confirmed' || status === 'answered') return p.ok
  if (status === 'invalidated') return p.bad
  if (status === 'active') return p.active
  if (status === 'dropped') return p.off
  return p.warn
}

export type GraphItem = { entry: Entry; depth: number; row: number; parentRow: number | null; node: GraphNode }

/** The tree flattened to rows with their depth and their parent's row, capped at `max` rows. */
export function graphLayout(roots: GraphNode[], max = GRAPH_MAX_NODES): GraphItem[] {
  const out: GraphItem[] = []
  const walk = (n: GraphNode, depth: number, parentRow: number | null) => {
    if (out.length >= max) return
    const row = out.length
    out.push({ entry: n.entry, depth, row, parentRow, node: n })
    n.children.forEach(c => walk(c, depth + 1, row))
  }
  roots.forEach(r => walk(r, 0, null))
  return out
}

/** Alt text for the structure SVG: each entry with its kind, parent and status. */
export function graphAlt(roots: GraphNode[], unlinked = 0, fresh: ReadonlySet<string> = new Set()): string {
  const items = graphLayout(roots, 400)
  const rows = items.map(it => {
    const parent = it.parentRow === null ? null : items[it.parentRow]?.entry.id
    const hit = it.node.touched.length > 0 ? `, affected by invalidated ${it.node.touched.join(' and ')}` : ''
    return `${it.entry.id}, ${it.entry.kind}${parent ? ` under ${parent}` : ''}, ${it.entry.status}${hit}${fresh.has(it.entry.id) ? ', changed this turn' : ''}: ${it.entry.text}`
  })
  return `Structure: ${rows.join('; ')}${unlinked > 0 ? `; ${unlinked} more entries are not linked into the tree` : ''}`
}

/** Alt text for the history SVG. */
export function historyAlt(history: History): string {
  const rows = history.rows.map(r => `${r.entry.id} ${r.entry.status} (logged T${r.entry.turn}${r.entry.closedTurn !== null ? `, settled T${r.entry.closedTurn}` : ', still open'})`)
  return `History, turns ${history.turns[0]} to ${history.turns[history.turns.length - 1]}: ${rows.join('; ')}`
}

export const SVG_WIDTH = 480
const ROW = 24
const INDENT = 22

/** The structure tree as an SVG: a dot per entry coloured by status, elbow edges to its parent. */
export function graphSvg(roots: GraphNode[], width = SVG_WIDTH, pal: Palette = paletteOf(DEFAULT_PALETTE_ID), unlinked = 0, fresh: ReadonlySet<string> = new Set()): string {
  const items = graphLayout(roots)
  const height = items.length * ROW + 16 + (unlinked > 0 ? 20 : 0)
  const x = (depth: number) => 14 + depth * INDENT
  const y = (row: number) => 14 + row * ROW
  const parts: string[] = []
  for (const it of items) {
    if (it.parentRow === null) continue
    const parent = items[it.parentRow]
    if (!parent) continue
    parts.push(`<path class="${it.node.onDamage ? 'eb' : 'e'}" d="M${x(parent.depth)} ${y(parent.row) + 6}V${y(it.row)}H${x(it.depth) - 6}"/>`)
  }
  for (const it of items) {
    const e = it.entry
    const cx = x(it.depth)
    const cy = y(it.row)
    const tag = touchedTag(it.node.touched)
    const extra = it.node.hidden > 0 ? ` (+${it.node.hidden})` : ''
    const idEnd = cx + 14 + (e.id.length + 1) * 7
    const labelX = tag ? idEnd + (tag.length + 1) * 7 : idEnd
    const room = Math.max(6, Math.floor((width - labelX - 12) / 7) - extra.length)
    const label = clip(e.text, room)
    const dim = (e.status === 'done' || e.status === 'confirmed' || e.status === 'dropped') && !it.node.onPath
    const fill = statusColor(e.status, pal)
    // A ring marks the path from the goal to the step being worked on.
    const ring = it.node.onPath ? ` stroke="${pal.text}" stroke-width="2"` : ''
    const shape =
      e.kind === 'goal'
        ? `<rect x="${cx - 7}" y="${cy - 7}" width="14" height="14" rx="3" fill="${fill}"${ring}/>`
        : e.kind === 'decision'
          ? `<rect x="${cx - 5.5}" y="${cy - 5.5}" width="11" height="11" transform="rotate(45 ${cx} ${cy})" fill="${fill}"${ring}/>`
          : `<circle cx="${cx}" cy="${cy}" r="7" fill="${fill}"${ring}/>`
    const mark = e.kind === 'goal' || e.kind === 'decision' ? '' : `<text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${markOn(fill, pal)}">${esc(svgGlyph(e))}</text>`
    // A thin bar at the card's left edge marks what changed since your last prompt.
    if (fresh.has(e.id)) parts.push(`<rect x="3" y="${cy - 7}" width="3" height="14" rx="1.5" fill="${pal.accent}"/>`)
    parts.push(shape, mark, `<text class="d" x="${cx + 14}" y="${cy + 4}">${esc(e.id)}</text>`)
    if (tag) parts.push(`<text class="d" x="${idEnd}" y="${cy + 4}" fill="${pal.bad}" style="fill:${pal.bad}">${esc(tag)}</text>`)
    parts.push(`<text class="${dim ? 'd' : 't'}" x="${labelX}" y="${cy + 4}"${it.node.onPath ? ' font-weight="700"' : ''}>${esc(label)}</text>`)
    if (extra) parts.push(`<text class="d" x="${labelX + (label.length + 1) * 7}" y="${cy + 4}">${esc(extra.trim())}</text>`)
  }
  if (unlinked > 0) parts.push(`<text class="d" x="14" y="${height - 10}">${unlinked} more ${unlinked === 1 ? 'entry is' : 'entries are'} not linked into the tree</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${svgStyle(pal)}${svgCard(width, height, pal)}${parts.join('')}</svg>`
}

const CELL = 26
const LABEL = 190

/** The history grid as an SVG: a bar from the turn an entry was logged to the turn it settled. */
export function historySvg(history: History, pal: Palette = paletteOf(DEFAULT_PALETTE_ID)): string {
  const cols = history.turns.length
  const width = Math.max(LABEL + cols * CELL + 12, 310)
  const rowsTop = 30
  const height = rowsTop + history.rows.length * 22 + 30
  const cx = (i: number) => LABEL + i * CELL + CELL / 2
  const parts: string[] = []
  // The current turn's column is lightly shaded, so "still open" reads as "open until now".
  parts.push(`<rect x="${LABEL + (cols - 1) * CELL}" y="2" width="${CELL}" height="${height - 26}" rx="4" fill="${pal.surface}"/>`)
  history.turns.forEach((t, i) => parts.push(`<text class="${i === cols - 1 ? 't' : 'd'}" x="${cx(i)}" y="16" text-anchor="middle">${t % 100}</text>`))
  history.rows.forEach((r, ri) => {
    const cy = rowsTop + ri * 22 + 8
    const e = r.entry
    const settled = isSettled(e.status)
    const first = r.cells.findIndex(c => c.trim() !== '')
    let last = -1
    r.cells.forEach((c, i) => {
      if (c.trim() !== '') last = i
    })
    const room = Math.floor((LABEL - 12) / 7) - e.id.length - 1
    const text = clip(e.text, room)
    parts.push(`<text class="t" x="4" y="${cy + 4}">${esc(e.id)}</text><text class="${settled ? 'd' : 't'}" x="${4 + (e.id.length + 1) * 7}" y="${cy + 4}">${esc(text)}</text>`)
    if (first < 0) return
    if (last > first) parts.push(`<line class="e" x1="${cx(first)}" y1="${cy}" x2="${cx(last)}" y2="${cy}"/>`)
    if (!settled || last > first) parts.push(`<circle cx="${cx(first)}" cy="${cy}" r="4" fill="${statusColor('open', pal)}"/>`)
    if (settled) parts.push(`<circle cx="${cx(last)}" cy="${cy}" r="7" fill="${statusColor(e.status, pal)}"/><text x="${cx(last)}" y="${cy + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${markOn(statusColor(e.status, pal), pal)}">${esc(endGlyph(e.status))}</text>`)
  })
  parts.push(`<text class="d" x="4" y="${height - 10}"><tspan fill="${statusColor('open', pal)}">●</tspan> logged  ── open  ✓ done  ✗ wrong  × dropped</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${svgStyle(pal)}${svgCard(width, height, pal)}${parts.join('')}</svg>`
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
/** `since`: marks the user made before this time were already reported on an earlier call (a mark in the same millisecond as that call is reported once more). */
export function toolReply(applied: Applied, entries: Entry[], since = 0): string {
  const lines: string[] = []
  if (applied.added.length > 0) lines.push(`Logged ${applied.added.map(e => e.id).join(', ')}.`)
  if (applied.changed.length > 0) lines.push(`Updated ${applied.changed.map(c => `${c.entry.id} → ${c.entry.status}`).join(', ')}.`)
  if (applied.problems.length > 0) lines.push(`Not recorded: ${applied.problems.join('; ')}.`)
  const byYou = entries.filter(e => e.resolvedBy === 'you' && e.updatedAt >= since)
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
  '- Resolve entries as you learn: confirm or invalidate assumptions (say what you found in `note`), mark steps active and done, answer questions. If the plan changes, drop the obsolete steps and add the new ones. When a goal is finished or abandoned, mark it done or dropped.',
  '- Steps hang off the goal in the pane\'s structure tree. To show how things relate, pass `of`: an id from an earlier result, or "@N" for the Nth entry of the same call ("@2" is the second), e.g. a sub-step of S2, or an assumption of the step it rests on.',
  '- If you keep a todo or task list, the ledger reads it; you need not repeat those steps.',
  '- Batch entries; one short line each. Skip the ledger for one-step requests and plain conversation.',
  '- The ledger is for transparency, not a substitute for asking: when a wrong guess would be costly, ask the user.',
  '- If the user marks an assumption in the pane, the next ledger result tells you once; adjust your plan accordingly.',
].join('\n')
