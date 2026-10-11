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
  normalizeMeta,
  normalizeTimeline,
  normalizeTurn,
  parseCall,
  parseConfig,
  shorten,
  sortedAssumptions,
  statusLine,
  syncTodos,
  toMarkdown,
  toolReply,
  updateTask,
  withClosedTurns,
} from './core'
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
    const [m, list] = await Promise.all([getMeta($), getEntries($)])
    const applied = applyCall(m, list, call, stamp)
    await update($, meta, () => applied.meta)
    await update($, entries, () => withClosedTurns(list, applied.entries, stamp.turn))
    await note($, momentsFor(applied, stamp))
    if (applied.added.length + applied.changed.length > 0) {
      await update($, turn, t => ({ ...normalizeTurn(t), logged: normalizeTurn(t).logged + 1 }))
    }
    if (applied.changed.some(c => c.entry.kind === 'assumption' && c.entry.status === 'invalidated')) {
      $.ui.toast(`${PLUGIN}: an assumption was invalidated`)
    }
    await refreshStatus($, cfg)
    return { result: toolReply(applied, applied.entries) }
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
      const [m, list] = await Promise.all([getMeta($), getEntries($)])
      const synced = syncTodos(m, list, listOf<Todo>(input.todos), stamp)
      await update($, meta, () => synced.meta)
      await update($, entries, () => withClosedTurns(list, synced.entries, stamp.turn))
      if (synced.summary) await note($, [moment(stamp, synced.summary, 'info')])
      await refreshStatus($, cfg)
    } else if (name === 'TaskCreate') {
      const task = (ran.result as { task?: { id?: unknown; subject?: unknown } } | undefined)?.task
      if (task && typeof task.id === 'string') {
        const stamp = await stampFor($, e.agentId, 'observed')
        const [m, list] = await Promise.all([getMeta($), getEntries($)])
        const added = addTask(m, list, task.id, String(task.subject ?? input.subject ?? ''), stamp)
        await update($, meta, () => added.meta)
        await update($, entries, () => withClosedTurns(list, added.entries, stamp.turn))
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const [list, moments, t, fp, v, approved] = await Promise.all([getEntries($), getTimeline($), getTurn($), getFootprint($), getView($), getPlan($)])
    const width = Math.max(24, e.props.bodyColumns)
    const c = countsOf(list, t.n, cfg.staleAfterTurns)
    const goal = currentGoal(list)
    const now = activeStep(list)

    const toggle = (id: string) => update($, view, x => ({ expanded: normalize(DEFAULT_VIEW, x).expanded === id ? null : id }))
    const mark = async (id: string, status: Status) => {
      const at = await $.clock.now()
      const cur = await getEntries($)
      const res = markByYou(cur, id, status, at)
      if (!res.entry) return
      const hit: Entry = res.entry
      const turnNow = (await getTurn($)).n
      await update($, entries, () => withClosedTurns(cur, res.entries, turnNow))
      await note($, [moment({ at, turn: turnNow, who: 'you' }, `marked ${hit.id} ${hit.status}`, 'you')])
      await refreshStatus($, cfg)
      if (hit.status === 'invalidated') {
        // A draft in the person's own prompt box: they decide whether and how to tell the agent.
        await $.prompt.fill({ text: `Assumption ${hit.id} ("${shorten(hit.text, 80)}") is wrong: `, mode: 'append' }).catch(() => undefined)
        $.ui.toast('A correction is drafted in your prompt: finish it and send.')
      }
    }

    const header = (label: string, extra: string) => (
      <Box flexDirection="row">
        <Text bold color="claude">{label}</Text>
        <Text dimColor wrap="truncate-end">{extra ? `  ${extra}` : ''}</Text>
      </Box>
    )

    // ------------------------------------------------ inline: a short summary
    if (e.props.placement === 'inline') {
      const rows = [
        <Text wrap="truncate-end">
          <Text bold color="claude">GOAL </Text>
          {goal ? goal.text : <Text dimColor>none logged yet</Text>}
        </Text>,
        <Text wrap="truncate-end">
          <Text color="warning">{`${c.open} open`}</Text>
          <Text dimColor>{` · ${c.confirmed} ✓ · `}</Text>
          <Text color={c.invalidated > 0 ? 'error' : 'subtle'}>{`${c.invalidated} ✗`}</Text>
          <Text dimColor>{c.stale > 0 ? ` · ${c.stale} stale` : ''}{c.steps > 0 ? ` · plan ${c.stepsDone}/${c.steps}` : ''}{c.questions > 0 ? ` · ${c.questions} questions` : ''}</Text>
        </Text>,
        now ? <Text wrap="truncate-end"><Text color="suggestion">▸ </Text>{now.text}</Text> : null,
        ...moments.slice(-3).map(m => <Text dimColor wrap="truncate-end">{`T${m.turn} ${m.who}: ${m.text}`}</Text>),
      ].filter(Boolean)
      return <Box flexDirection="column">{rows}</Box>
    }

    // ------------------------------------------------ docked: the full ledger
    const assumptionRow = (a: Entry) => {
      const glyph = a.status === 'open' ? '?' : a.status === 'confirmed' ? '✓' : a.status === 'invalidated' ? '✗' : '–'
      const color = a.status === 'open' ? 'warning' : a.status === 'confirmed' ? 'success' : a.status === 'invalidated' ? 'error' : 'inactive'
      const stale = isStale(a, t.n, cfg.staleAfterTurns)
      const metaBits = [a.confidence ?? '', `T${a.turn}`, a.who !== 'main' ? a.who : '', stale ? 'stale' : '', a.resolvedBy === 'you' ? 'by you' : ''].filter(Boolean).join(' · ')
      const room = Math.max(8, width - metaBits.length - a.id.length - 6)
      const isOpen = v.expanded === a.id
      return (
        <Box flexDirection="column">
          <Button key={`row:${a.id}`} plain onPress={() => toggle(a.id)}>
            <Text color={color}>{glyph} </Text>
            <Text dimColor>{a.id} </Text>
            <Text strikethrough={a.status === 'dropped'}>{shorten(a.text, room)}</Text>
            <Text color={stale ? 'warning' : 'subtle'}>{metaBits ? `  ${metaBits}` : ''}</Text>
          </Button>
          {isOpen && (
            <Box flexDirection="column" paddingLeft={4}>
              {a.text.length > room && <Text>{a.text}</Text>}
              {a.why && <Text dimColor>why: {a.why}</Text>}
              {a.note && <Text dimColor>note: {a.note}</Text>}
              <Box flexDirection="row" gap={1}>
                {a.status !== 'confirmed' && <Button key={`ok:${a.id}`} label="✓ confirm" onPress={() => mark(a.id, 'confirmed')} />}
                {a.status !== 'invalidated' && <Button key={`no:${a.id}`} label="✗ wrong" onPress={() => mark(a.id, 'invalidated')} />}
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
    const stepsShown = [...steps.filter(s => s.status === 'done').slice(-2), ...steps.filter(s => s.status !== 'done')].slice(0, 10)
    const graph = graphLines(buildGraph(list))
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
        </Box>

        {graph.length > 1 && (
          <Box flexDirection="column">
            {header('STRUCTURE', '')}
            {graph.map(l => (
              <Text wrap="truncate-end" dimColor={l.entry.status === 'done' || l.entry.status === 'confirmed'}>
                <Text color="subtle">{l.prefix}</Text>
                <Text color={l.entry.status === 'invalidated' ? 'error' : l.entry.status === 'active' ? 'suggestion' : l.entry.kind === 'goal' ? 'claude' : undefined}>{`${l.glyph} `}</Text>
                <Text dimColor>{`${l.entry.id} `}</Text>
                {l.entry.text}
              </Text>
            ))}
          </Box>
        )}

        {history.turns.length > 1 && history.rows.length > 1 && (
          <Box flexDirection="column">
            {header('HISTORY', `T${history.turns[0]}–T${history.turns[history.turns.length - 1]}`)}
            <Text wrap="truncate-end" dimColor>
              {fitText('', labelWidth + 1)}
              {history.turns.map(n => String(n % 100).padStart(2).padEnd(HISTORY_CELL)).join('')}
            </Text>
            {history.rows.map(r => (
              <Text wrap="truncate-end">
                <Text dimColor>{fitText(`${r.entry.id} ${r.entry.text}`, labelWidth + 1)}</Text>
                {r.cells.map(c => (
                  <Text color={c.includes('✗') ? 'error' : c.includes('✓') ? 'success' : 'subtle'}>{c}</Text>
                ))}
              </Text>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          {header('ASSUMPTIONS', assumptions.length > 0 ? `${c.open} open · ${c.confirmed} ✓ · ${c.invalidated} ✗${c.stale > 0 ? ` · ${c.stale} stale` : ''}` : '')}
          {shownAssumptions.length === 0 && <Text dimColor>None logged.</Text>}
          {shownAssumptions.map(assumptionRow)}
          {assumptions.length > shownAssumptions.length && <Text dimColor>{`+${assumptions.length - shownAssumptions.length} more (/ledger copy for all)`}</Text>}
        </Box>

        {(stepsShown.length > 0 || approved) && (
          <Box flexDirection="column">
            {header('PLAN', steps.length > 0 ? `${c.stepsDone}/${c.steps} done` : '')}
            {stepsShown.map(s => (
              <Text wrap="truncate-end" dimColor={s.status === 'done'}>
                <Text color={s.status === 'active' ? 'suggestion' : s.status === 'done' ? 'success' : 'subtle'}>{s.status === 'active' ? '▸ ' : s.status === 'done' ? '✓ ' : '· '}</Text>
                {s.text}
                <Text color="subtle">{s.source === 'observed' ? '  todo' : ''}</Text>
              </Text>
            ))}
            {approved && (
              <Button key="row:plan" plain onPress={() => toggle('plan')}>
                <Text color="planMode">◆ </Text>
                <Text dimColor>{`approved plan · T${approved.turn} · ${v.expanded === 'plan' ? 'hide' : 'show'}`}</Text>
              </Button>
            )}
            {approved && v.expanded === 'plan' && (
              <Box paddingLeft={2} flexDirection="column">
                {approved.text.split('\n').slice(0, 40).map(line => <Text dimColor>{line}</Text>)}
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
                <Text color="suggestion">• </Text>
                <Text dimColor>{f.id} </Text>
                {f.text}
                <Text dimColor>{f.why ? ` — ${f.why}` : ''}</Text>
              </Text>
            ))}
          </Box>
        )}

        {openQs.length > 0 && (
          <Box flexDirection="column">
            {header('OPEN QUESTIONS & RISKS', '')}
            {openQs.map(q => (
              <Text wrap="truncate-end">
                <Text color={q.kind === 'risk' ? 'error' : 'warning'}>{q.kind === 'risk' ? '! ' : '? '}</Text>
                <Text dimColor>{q.id} </Text>
                {q.text}
              </Text>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          {header('TIMELINE', '')}
          {moments.length === 0 && <Text dimColor>Nothing yet.</Text>}
          {moments.slice(-10).map(m => (
            <Text wrap="truncate-end" color={m.tone === 'warn' ? 'warning' : undefined} dimColor={m.tone === 'info'}>
              <Text dimColor>{`T${m.turn} `}</Text>
              <Text color={m.who === 'you' ? 'suggestion' : 'subtle'}>{`${m.who} `}</Text>
              {m.text}
            </Text>
          ))}
        </Box>

        {(fp.files.length > 0 || fp.unloggedTurns.length > 0) && (
          <Text wrap="truncate-end" dimColor>
            {`${fp.files.length} file${fp.files.length === 1 ? '' : 's'} touched`}
            {fp.unloggedTurns.length > 0 ? <Text color="warning">{` · unlogged changes in T${fp.unloggedTurns.slice(-4).join(', T')}`}</Text> : ''}
          </Text>
        )}
      </Box>
    )
  })
}
