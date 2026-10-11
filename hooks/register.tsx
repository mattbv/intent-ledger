import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ApprovedPlan, Entry, Footprint, Meta, Moment, Status, Turn, View } from '../types'
import {
  DEFAULT_FOOTPRINT,
  DEFAULT_META,
  DEFAULT_TURN,
  DEFAULT_VIEW,
  HISTORY_CELL,
  INSTRUCTIONS,
  PLUGIN,
  SCHEMA_VERSION,
  TOOL,
  TOOL_DESCRIPTION,
  TOOL_NAME,
  TOOL_SCHEMA,
  activeStep,
  addMoments,
  addTask,
  applyCall,
  baseName,
  buildGraph,
  buildHistory,
  SVG_WIDTH,
  graphAlt,
  unlinkedCount,
  graphSvg,
  historyAlt,
  historySvg,
  clean,
  countsOf,
  currentGoal,
  fitText,
  graphLines,
  isStale,
  listOf,
  markByYou,
  moment,
  momentsFor,
  normalize,
  normalizeEntries,
  normalizeFootprint,
  mergeMeta,
  normalizeMeta,
  normalizeTimeline,
  normalizeTurn,
  parseCall,
  parseConfig,
  shorten,
  stripUnsafe,
  sortedAssumptions,
  statusLine,
  syncTodos,
  toMarkdown,
  toolReply,
  termColors,
  updateTask,
  withClosedTurns,
} from './core'
import { paletteOf } from './palettes'
import type { Config, Stamp, Todo } from './core'

const PANE = 'intent-ledger'
const TITLE = 'Intent'
const PANE_COLUMNS = 60
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// ---------------------------------------------------------------- state

const meta = atom({ plugin: 'intent-ledger', key: 'meta' } as const, DEFAULT_META)
const entries = atom({ plugin: 'intent-ledger', key: 'entries' } as const, [])
const timeline = atom({ plugin: 'intent-ledger', key: 'timeline' } as const, [])
const turn = atom({ plugin: 'intent-ledger', key: 'turn' } as const, DEFAULT_TURN)
const plan = atom({ plugin: 'intent-ledger', key: 'plan' } as const, null)
const footprint = atom({ plugin: 'intent-ledger', key: 'footprint' } as const, DEFAULT_FOOTPRINT)
const view = atom({ plugin: 'intent-ledger', key: 'view' } as const, DEFAULT_VIEW)

const getMeta = async ($: EngineInterface): Promise<Meta> => normalizeMeta(await read($, meta))
const getEntries = async ($: EngineInterface): Promise<Entry[]> => normalizeEntries(await read($, entries))
/**
 * Apply one change to the entries inside a single `update`, so it reads the latest list and a
 * concurrent writer's change is not overwritten. Counters merge by maximum afterwards.
 */
async function mutate<T>($: EngineInterface, turnNo: number, fn: (list: Entry[], m: Meta) => { entries: Entry[]; meta?: Meta; out: T }): Promise<T> {
  const m = await getMeta($)
  let result: { entries: Entry[]; meta?: Meta; out: T } | undefined
  await update($, entries, cur => {
    const list = normalizeEntries(cur)
    result = fn(list, m)
    return withClosedTurns(list, result.entries, turnNo)
  })
  const done = result as { entries: Entry[]; meta?: Meta; out: T } | undefined
  if (!done) throw new Error('intent-ledger: the entries update did not run')
  if (done.meta) {
    const next = done.meta
    await update($, meta, cur => mergeMeta(normalizeMeta(cur), next))
  }
  return done.out
}

const getTimeline = async ($: EngineInterface): Promise<Moment[]> => normalizeTimeline(await read($, timeline))
const getTurn = async ($: EngineInterface): Promise<Turn> => normalizeTurn(await read($, turn))
const getFootprint = async ($: EngineInterface): Promise<Footprint> => normalizeFootprint(await read($, footprint))
const getView = async ($: EngineInterface): Promise<View> => normalize(DEFAULT_VIEW, await read($, view))
async function getPlan($: EngineInterface): Promise<ApprovedPlan | null> {
  const p = await read($, plan)
  return p && typeof p.text === 'string' ? p : null
}

async function migrate($: EngineInterface) {
  const m = await getMeta($)
  if (m.schemaVersion >= SCHEMA_VERSION) return
  await update($, entries, list => normalizeEntries(list))
  await update($, timeline, list => normalizeTimeline(list))
  await update($, meta, () => ({ ...m, schemaVersion: SCHEMA_VERSION }))
}

async function resetAll($: EngineInterface) {
  await update($, meta, () => DEFAULT_META)
  await update($, entries, () => [])
  await update($, timeline, () => [])
  await update($, turn, () => DEFAULT_TURN)
  await update($, plan, () => null)
  await update($, footprint, () => DEFAULT_FOOTPRINT)
  await update($, view, () => DEFAULT_VIEW)
}

function whoOf(agentId: string | undefined): string {
  return agentId ? `sub·${agentId.slice(0, 5)}` : 'main'
}

async function stampFor($: EngineInterface, agentId: string | undefined, source: Stamp['source']): Promise<Stamp> {
  const [at, t] = await Promise.all([$.clock.now(), getTurn($)])
  return { at, turn: t.n, who: whoOf(agentId), source }
}

async function note($: EngineInterface, list: Moment[]) {
  if (list.length > 0) await update($, timeline, x => addMoments(normalizeTimeline(x), list))
}

async function refreshStatus($: EngineInterface, cfg: Config) {
  if (!cfg.statusLine) return $.ui.status(undefined)
  const [list, t] = await Promise.all([getEntries($), getTurn($)])
  $.ui.status(statusLine(list, t.n, cfg.staleAfterTurns))
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS, rows: 7 })
}

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  const cfg = parseConfig(options as Record<string, unknown> | undefined)

  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA as unknown as Record<string, unknown>, isDeferred: false })
    await $.command.register({
      name: 'ledger',
      description: 'Intent Ledger: open the pane, close it, reset it, or copy the ledger as Markdown',
      argumentHint: '[open|close|reset|copy]',
    })
    await migrate($)
    if (cfg.openOnStart) void openPane($).catch(() => undefined)
    await refreshStatus($, cfg)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await resetAll($)
      await refreshStatus($, cfg)
    }
    return next(e)
  })

  on('command.run', { command: 'ledger' }, async ($, e) => {
    const verb = e.args.trim().split(/\s+/)[0] || 'open'
    if (verb === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Intent Ledger closed.' }
    }
    if (verb === 'reset') {
      await resetAll($)
      await refreshStatus($, cfg)
      return { text: 'Intent Ledger cleared.' }
    }
    if (verb === 'copy') {
      const md = toMarkdown(await getEntries($), await getPlan($))
      const copied = await $.ui.copy({ text: md }).catch(() => ({ isCopied: false as const }))
      return { text: copied.isCopied ? 'Ledger copied as Markdown.' : md }
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Intent Ledger opened. Focus it with ctrl+x tab; press a row to expand it.' : `Intent Ledger is not shown yet: ${opened.reason}` }
  })

  // The instructions ride in the system prompt only where the ledger tool is offered.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!cfg.instructAgent || !e.tools.includes(TOOL)) return composed
    return { sections: [...composed.sections, { id: `${PLUGIN}:instructions`, text: INSTRUCTIONS, scope: 'session' as const }] }
  })

  // The ledger tool writes to this pane and nothing else, so it need not interrupt the person.
  on('tool.check', { tool: 'mcp__intent-ledger__ledger' }, async ($, e, next) => {
    const verdict = await next(e)
    if (!cfg.autoAllow || verdict.decision === 'deny') return verdict
    return { ...verdict, decision: 'allow' as const, reason: `${PLUGIN}: the ledger tool writes only to the ledger pane` }
  }).catch(($, e, next) => next(e))

  // The ledger tool itself.
  on('tool.call', { tool: 'mcp__intent-ledger__ledger' }, async ($, e) => {
    const call = parseCall(e as unknown)
    const stamp = await stampFor($, e.agentId, 'agent')
    const since = (await getMeta($)).reportedAt
    const applied = await mutate($, stamp.turn, (list, m) => {
      const a = applyCall(m, list, call, stamp)
      return { entries: a.entries, meta: a.meta, out: a }
    })
    await note($, momentsFor(applied, stamp))
    if (applied.added.length + applied.changed.length > 0) {
      await update($, turn, t => ({ ...normalizeTurn(t), logged: normalizeTurn(t).logged + 1 }))
    }
    if (applied.changed.some(c => c.entry.kind === 'assumption' && c.entry.status === 'invalidated')) {
      $.ui.toast(`${PLUGIN}: an assumption was invalidated`)
    }
    await refreshStatus($, cfg)
    await update($, meta, cur => mergeMeta(normalizeMeta(cur), { ...DEFAULT_META, reportedAt: stamp.at }))
    return { result: toolReply(applied, applied.entries, since) }
  })

  // Visible actions: edits for the footprint, and todo lists, tasks and approved plans for the plan.
  on('tool.call', async ($, e, next) => {
    const name = String(e.tool)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const input = e as unknown as Record<string, unknown>

    if (EDIT_TOOLS.has(name)) {
      const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null
      if (path) {
        await update($, turn, t => {
          const x = normalizeTurn(t)
          return x.edits.includes(path) ? x : { ...x, edits: [...x.edits, path] }
        })
        await update($, footprint, f => {
          const x = normalizeFootprint(f)
          return x.files.includes(path) ? x : { ...x, files: [...x.files, path].slice(-200) }
        })
      }
      return ran
    }

    if (!cfg.observePlans) return ran

    if (name === 'TodoWrite') {
      const stamp = await stampFor($, e.agentId, 'observed')
      const synced = await mutate($, stamp.turn, (list, m) => {
        const r = syncTodos(m, list, listOf<Todo>(input.todos), stamp)
        return { entries: r.entries, meta: r.meta, out: r }
      })
      if (synced.summary) await note($, [moment(stamp, synced.summary, 'info')])
      await refreshStatus($, cfg)
    } else if (name === 'TaskCreate') {
      const task = (ran.result as { task?: { id?: unknown; subject?: unknown } } | undefined)?.task
      if (task && typeof task.id === 'string') {
        const stamp = await stampFor($, e.agentId, 'observed')
        await mutate($, stamp.turn, (list, m) => {
          const r = addTask(m, list, task.id as string, String(task.subject ?? input.subject ?? ''), stamp)
          return { entries: r.entries, meta: r.meta, out: null }
        })
        await refreshStatus($, cfg)
      }
    } else if (name === 'TaskUpdate' && typeof input.taskId === 'string') {
      const at = await $.clock.now()
      const patch = { status: typeof input.status === 'string' ? input.status : undefined, subject: typeof input.subject === 'string' ? input.subject : undefined }
      const turnNow = (await getTurn($)).n
      await update($, entries, list => withClosedTurns(normalizeEntries(list), updateTask(normalizeEntries(list), input.taskId as string, patch, at), turnNow))
      await refreshStatus($, cfg)
    } else if (name === 'ExitPlanMode') {
      const text = (ran.result as { plan?: unknown } | undefined)?.plan
      if (typeof text === 'string' && text.trim()) {
        const stamp = await stampFor($, e.agentId, 'observed')
        await update($, plan, () => ({ text: text.trim(), at: stamp.at, turn: stamp.turn }))
        await note($, [moment(stamp, `plan approved · ${clean(text.split('\n').find(l => l.trim()) ?? '', 80)}`, 'info')])
      }
    }
    return ran
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, turn, t => ({ ...DEFAULT_TURN, n: normalizeTurn(t).n + 1, startedAt: now, isRunning: true }))
    if (e.text.trim()) {
      const t = await getTurn($)
      await note($, [moment({ at: now, turn: t.n, who: 'you' }, shorten(clean(e.text), 90), 'you')])
    }
    await refreshStatus($, cfg)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId) return done
    const t = await getTurn($)
    await update($, turn, x => ({ ...normalizeTurn(x), isRunning: false }))
    // Changes made with nothing logged are the moments a monitor most wants to see.
    if (cfg.instructAgent && t.edits.length > 0 && t.logged === 0) {
      const now = await $.clock.now()
      const files = t.edits.map(baseName)
      await note($, [moment({ at: now, turn: t.n, who: 'main' }, `changed ${files.length} file${files.length === 1 ? '' : 's'} with nothing logged (${shorten(files.join(', '), 60)})`, 'warn')])
      await update($, footprint, f => {
        const x = normalizeFootprint(f)
        return { ...x, unloggedTurns: [...x.unloggedTurns, t.n].slice(-20) }
      })
    }
    await refreshStatus($, cfg)
    return done
  })

  // ---------------------------------------------------------------- the pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // Only the remote surfaces (desktop, VS Code, mobile) draw Svg; the terminal keeps the text layouts.
    const Svg = e.surface === 'terminal' ? undefined : (els as unknown as { Svg?: (props: { source: string; alt: string }) => unknown }).Svg
    const [list, moments, t, fp, v, approved] = await Promise.all([getEntries($), getTimeline($), getTurn($), getFootprint($), getView($), getPlan($)])
    const width = Math.max(24, e.props.bodyColumns)
    const c = countsOf(list, t.n, cfg.staleAfterTurns)
    const goal = currentGoal(list)
    const now = activeStep(list)

    const toggle = (id: string) => update($, view, x => ({ expanded: normalize(DEFAULT_VIEW, x).expanded === id ? null : id }))
    const mark = async (id: string, status: Status) => {
      const at = await $.clock.now()
      const turnNow = (await getTurn($)).n
      const found = await mutate($, turnNow, cur => {
        const res = markByYou(cur, id, status, at)
        return { entries: res.entries, out: res.entry }
      })
      if (!found) return
      const hit: Entry = found
      await note($, [moment({ at, turn: turnNow, who: 'you' }, `marked ${hit.id} ${hit.status}`, 'you')])
      await refreshStatus($, cfg)
      if (hit.status === 'invalidated') {
        // A draft in the person's own prompt box: they decide whether and how to tell the agent.
        await $.prompt.fill({ text: `Assumption ${hit.id} ("${shorten(hit.text, 80)}") is wrong: `, mode: 'append' }).catch(() => undefined)
        $.ui.toast('A reply is drafted in your prompt: finish it and send.')
      }
    }

    // Headers take the terminal's own foreground; the brand orange is opt-in (`brandAccent`).
    const pal = paletteOf(cfg.palette)
    const K = termColors(pal, cfg.brandAccent)
    const accent = K.accent
    const header = (label: string, extra: string) => (
      <Box flexDirection="row">
        <Text bold color={accent}>{label}</Text>
        <Text dimColor wrap="truncate-end">{extra ? `  ${extra}` : ''}</Text>
      </Box>
    )

    // ------------------------------------------------ inline: a short summary
    if (e.props.placement === 'inline') {
      const rows = [
        <Text wrap="truncate-end">
          <Text bold color={accent}>GOAL </Text>
          {goal ? goal.text : <Text dimColor>none logged yet</Text>}
        </Text>,
        now ? <Text wrap="truncate-end"><Text color={K.suggestion} bold>{'▸ NOW '}</Text>{now.text}</Text> : null,
        <Text wrap="truncate-end">
          <Text color={K.warning}>{`${c.open} open`}</Text>
          <Text dimColor>{` · ${c.confirmed} ✓ · `}</Text>
          <Text color={c.invalidated > 0 ? K.error : K.subtle}>{`${c.invalidated} ✗`}</Text>
          <Text color={K.warning}>{c.stale > 0 ? ` · ${c.stale} stale` : ''}</Text>
          <Text dimColor>{c.steps > 0 ? ` · plan ${c.stepsDone}/${c.steps}` : ''}{c.questions > 0 ? ` · ${c.questions} questions` : ''}</Text>
        </Text>,
        ...moments.slice(-1).map(m => <Text dimColor wrap="truncate-end">{`T${m.turn} ${m.who}: ${m.text}`}</Text>),
      ].filter(Boolean)
      return <Box flexDirection="column">{rows}</Box>
    }

    // ------------------------------------------------ docked: the full ledger
    const assumptionRow = (a: Entry) => {
      const glyph = a.status === 'open' ? '?' : a.status === 'confirmed' ? '✓' : a.status === 'invalidated' ? '✗' : '–'
      const color = a.status === 'open' ? K.warning : a.status === 'confirmed' ? K.success : a.status === 'invalidated' ? K.error : K.inactive
      const stale = isStale(a, t.n, cfg.staleAfterTurns)
      const metaBits = [a.confidence ?? '', `T${a.turn}`, a.who !== 'main' ? a.who : '', a.resolvedBy === 'you' ? 'by you' : ''].filter(Boolean).join(' · ')
      // `stale` leads the claim as a badge so a narrow pane never cuts it off; the chevron says the row opens.
      const room = Math.max(8, width - metaBits.length - a.id.length - (stale ? 14 : 6) - 2)
      const isOpen = v.expanded === a.id
      return (
        <Box flexDirection="column">
          <Button key={`row:${a.id}`} plain onPress={() => toggle(a.id)}>
            <Text color={color}>{glyph} </Text>
            <Text dimColor>{a.id} </Text>
            {stale && <Text color={K.warning} bold>{'stale '}</Text>}
            <Text strikethrough={a.status === 'dropped'}>{shorten(a.text, room)}</Text>
            <Text color={K.subtle}>{metaBits ? `  ${metaBits}` : ''}</Text>
            <Text color={K.subtle}>{isOpen ? '  ▾' : '  ▸'}</Text>
          </Button>
          {isOpen && (
            <Box flexDirection="column" paddingLeft={4}>
              {a.text.length > room && <Text>{a.text}</Text>}
              {a.why && <Text dimColor>why: {a.why}</Text>}
              {a.note && <Text dimColor>note: {a.note}</Text>}
              <Box flexDirection="row" gap={1}>
                {a.status !== 'confirmed' && <Button key={`ok:${a.id}`} label="✓ confirm" onPress={() => mark(a.id, 'confirmed')} />}
                {a.status !== 'invalidated' && <Button key={`no:${a.id}`} label="✗ wrong (drafts a reply)" onPress={() => mark(a.id, 'invalidated')} />}
                {a.status !== 'open' && <Button key={`re:${a.id}`} label="reopen" onPress={() => mark(a.id, 'open')} />}
              </Box>
            </Box>
          )}
        </Box>
      )
    }

    const assumptions = sortedAssumptions(list)
    const shownAssumptions = assumptions.filter(a => a.status !== 'dropped').slice(0, 12)
    const steps = list.filter(x => x.kind === 'step' && x.status !== 'dropped')
    const tree = buildGraph(list)
    const graph = graphLines(tree)
    const unlinked = unlinkedCount(list)
    // With the structure tree below, the plan keeps to what is active and next; the tree holds the rest.
    const stepsShown = graph.length > 1 ? steps.filter(s => s.status !== 'done').slice(0, 3) : [...steps.filter(s => s.status === 'done').slice(-2), ...steps.filter(s => s.status !== 'done')].slice(0, 10)
    const timelineShown = graph.length > 1 ? moments.filter(m => m.tone !== 'add') : moments
    const labelWidth = Math.min(24, Math.max(12, width - 12 * HISTORY_CELL - 1))
    const history = buildHistory(list, t.n, Math.max(2, Math.min(12, Math.floor((width - labelWidth - 1) / HISTORY_CELL))))
    const decisions = list.filter(x => x.kind === 'decision' && x.status !== 'dropped').slice(-4)
    const findings = list.filter(x => x.kind === 'finding' && x.status !== 'dropped').slice(-4)
    const openQs = list.filter(x => (x.kind === 'question' || x.kind === 'risk') && x.status === 'open').slice(-5)
    const otherGoals = list.filter(x => x.kind === 'goal' && x.id !== goal?.id && x.status !== 'dropped').length

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          {header('GOAL', otherGoals > 0 ? `${otherGoals} earlier` : '')}
          {goal ? <Text>{goal.text}</Text> : <Text dimColor>No goal logged yet. The agent logs one when it starts a multi-step task.</Text>}
          {now && (
            <Text wrap="truncate-end">
              <Text color={K.suggestion} bold>{'▸ NOW '}</Text>
              {now.text}
            </Text>
          )}
        </Box>

        <Box flexDirection="column">
          {header('ASSUMPTIONS', assumptions.length > 0 ? `${c.open} open · ${c.confirmed} ✓ · ${c.invalidated} ✗${c.stale > 0 ? ` · ${c.stale} stale` : ''}` : '')}
          {shownAssumptions.length === 0 && <Text dimColor>None logged yet. The agent adds them as it works.</Text>}
          {c.open > 0 && v.expanded === null && <Text dimColor>press a row to confirm or correct it</Text>}
          {shownAssumptions.map(assumptionRow)}
          {assumptions.length > shownAssumptions.length && <Text dimColor>{`+${assumptions.length - shownAssumptions.length} more (/ledger copy for all)`}</Text>}
        </Box>

        {openQs.length > 0 && (
          <Box flexDirection="column">
            {header('OPEN QUESTIONS & RISKS', '')}
            {openQs.map(q => (
              <Text wrap="truncate-end">
                <Text color={q.kind === 'risk' ? K.error : K.warning}>{q.kind === 'risk' ? '! ' : '? '}</Text>
                <Text dimColor>{q.id} </Text>
                {q.text}
              </Text>
            ))}
          </Box>
        )}

        {(stepsShown.length > 0 || approved) && (
          <Box flexDirection="column">
            {header('PLAN', steps.length > 0 ? `${c.stepsDone}/${c.steps} done` : '')}
            {stepsShown.map(s => (
              <Text wrap="truncate-end" dimColor={s.status === 'done'}>
                <Text color={s.status === 'active' ? K.suggestion : s.status === 'done' ? K.success : K.subtle}>{s.status === 'active' ? '▸ ' : s.status === 'done' ? '✓ ' : '· '}</Text>
                {s.text}
                <Text color={K.subtle}>{s.source === 'observed' ? '  todo' : ''}</Text>
              </Text>
            ))}
            {approved && (
              <Button key="row:plan" plain onPress={() => toggle('plan')}>
                <Text color={K.planMode}>◆ </Text>
                <Text dimColor>{`approved plan · T${approved.turn} · ${v.expanded === 'plan' ? 'hide' : 'show'}`}</Text>
              </Button>
            )}
            {approved && v.expanded === 'plan' && (
              <Box paddingLeft={2} flexDirection="column">
                {approved.text.split('\n').slice(0, 40).map(line => <Text dimColor wrap="truncate-end">{shorten(stripUnsafe(line), 200)}</Text>)}
              </Box>
            )}
          </Box>
        )}

        {decisions.length > 0 && (
          <Box flexDirection="column">
            {header('DECISIONS', '')}
            {decisions.map(d => (
              <Text wrap="truncate-end">
                <Text dimColor>{d.id} </Text>
                {d.text}
                <Text dimColor>{d.why ? ` — ${d.why}` : ''}</Text>
              </Text>
            ))}
          </Box>
        )}

        {findings.length > 0 && (
          <Box flexDirection="column">
            {header('FINDINGS', '')}
            {findings.map(f => (
              <Text wrap="truncate-end">
                <Text color={K.subtle}>• </Text>
                <Text dimColor>{f.id} </Text>
                {f.text}
                <Text dimColor>{f.why ? ` — ${f.why}` : ''}</Text>
              </Text>
            ))}
          </Box>
        )}

        {graph.length > 1 && (
          <Box flexDirection="column">
            {header('STRUCTURE', unlinked > 0 ? `${unlinked} unlinked` : '')}
            {Svg && <Svg source={graphSvg(tree, SVG_WIDTH, pal, unlinked)} alt={graphAlt(buildGraph(list, false), unlinked)} />}
            {!Svg && graph.map(l => (
              <Text wrap="truncate-end" dimColor={(l.entry.status === 'done' || l.entry.status === 'confirmed') && !l.onPath} bold={l.onPath}>
                <Text color={K.subtle}>{l.prefix}</Text>
                <Text color={l.entry.status === 'invalidated' ? K.error : l.entry.status === 'active' ? K.suggestion : l.entry.kind === 'goal' ? accent : undefined}>{`${l.glyph} `}</Text>
                <Text dimColor>{`${l.entry.id} `}</Text>
                {l.tag && <Text color={K.error}>{`${l.tag} `}</Text>}
                {l.entry.text}
                {l.hidden > 0 && <Text dimColor>{` (+${l.hidden})`}</Text>}
              </Text>
            ))}
          </Box>
        )}

        {history.turns.length > 1 && history.rows.length > 1 && (
          <Box flexDirection="column">
            {header('HISTORY', `T${history.turns[0]}–T${history.turns[history.turns.length - 1]}${history.turns[0] > 1 ? ` · last ${history.turns.length}` : ''}`)}
            {Svg && <Svg source={historySvg(history, pal)} alt={historyAlt(history)} />}
            {!Svg && (
            <Text wrap="truncate-end">
              <Text dimColor>{fitText('', labelWidth + 1)}</Text>
              {history.turns.map((n, i) => (
                <Text dimColor={i < history.turns.length - 1} bold={i === history.turns.length - 1}>{String(n % 100).padStart(2).padEnd(HISTORY_CELL)}</Text>
              ))}
            </Text>
            )}
            {!Svg && history.rows.map(r => (
              <Text wrap="truncate-end">
                <Text>{`${r.entry.id} `}</Text>
                <Text dimColor={r.entry.status !== 'open' && r.entry.status !== 'active'}>{fitText(r.entry.text, Math.max(0, labelWidth - r.entry.id.length))}</Text>
                {r.cells.map(c => (
                  <Text color={c.includes('✗') ? K.error : c.includes('✓') ? K.success : K.subtle}>{c}</Text>
                ))}
              </Text>
            ))}
            {!Svg && <Text dimColor wrap="truncate-end">○ logged  ─ open  ✓ done  ✗ wrong  × dropped</Text>}
          </Box>
        )}

        <Box flexDirection="column">
          {header('TIMELINE', '')}
          {moments.length === 0 && <Text dimColor>Nothing yet: your prompts and ledger changes appear here.</Text>}
          {timelineShown.slice(-10).map(m => (
            <Text wrap="truncate-end" color={m.tone === 'warn' ? K.warning : undefined} dimColor={m.tone === 'info'}>
              <Text dimColor>{`T${m.turn} `}</Text>
              <Text color={m.who === 'you' ? K.suggestion : K.subtle}>{`${m.who} `}</Text>
              {m.text}
            </Text>
          ))}
        </Box>

        {(fp.files.length > 0 || fp.unloggedTurns.length > 0) && (
          <Text wrap="truncate-end" dimColor>
            {`${fp.files.length} file${fp.files.length === 1 ? '' : 's'} touched`}
            {fp.unloggedTurns.length > 0 ? <Text color={K.warning}>{` · unlogged changes in T${fp.unloggedTurns.slice(-4).join(', T')}`}</Text> : ''}
          </Text>
        )}
      </Box>
    )
  })
}
