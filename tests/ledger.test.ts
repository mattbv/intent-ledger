import { expect, mock, test } from 'claude-code/testing'

import { PALETTES, contrast, markOn, paletteOf } from '../hooks/palettes'
import {
  DEFAULT_META,
  TOOL,
  applyCall,
  countsOf,
  buildGraph,
  parseConfig,
  statusText,
  VERSION,
  termColors,
  buildHistory,
  GRAPH_MAX_NODES,
  HARD_MAX_ENTRIES,
  MAX_ENTRIES,
  clean,
  clip,
  esc,
  limitTree,
  mergeMeta,
  nextId,
  trimEntries,
  activityByTurn,
  ageLevel,
  healthParts,
  isFresh,
  progressBar,
  sparkline,
  graphAlt,
  touchedTag,
  unlinkedCount,
  graphSvg,
  historySvg,
  withClosedTurns,
  fitStatus,
  graphLines,
  parseCall,
  statusLine,
  syncTodos,
  toolReply,
} from '../hooks/core'

const STAMP = { at: 1000, turn: 1, who: 'main', source: 'agent' as const }

const PANE_PROPS = {
  title: 'Intent',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

// ---------------------------------------------------------------- pure behaviour

test('the structure graph hangs steps off the goal and links entries through `of`', async () => {
  const at = (items: Array<Record<string, unknown>>, meta = DEFAULT_META, entries: ReturnType<typeof applyCall>['entries'] = []) =>
    applyCall(meta, entries, parseCall({ add: items }), STAMP)
  const a = at([
    { kind: 'goal', text: 'Ship it' },
    { kind: 'step', text: 'Read code' },
    { kind: 'step', text: 'Write code' },
    { kind: 'assumption', text: 'Loose assumption' },
  ])
  const b = at(
    [
      { kind: 'step', text: 'Add tests', of: 'S2' },
      { kind: 'assumption', text: 'Runner is bun', of: 'S2' },
      { kind: 'decision', text: 'Lost link', of: 'S99' },
    ],
    a.meta,
    a.entries,
  )
  expect(b.problems.join(' ')).toContain('no entry S99')
  const lines = graphLines(buildGraph(b.entries)).map(l => `${l.prefix}${l.glyph} ${l.entry.id}`)
  expect(lines).toEqual(['◎ G1', '├─ · S1', '└─ · S2', '   ├─ · S3', '   └─ ? A2'])
})

test('`of: "@N"` links to an entry of the same call, even past a refused or duplicate one', async () => {
  const a = applyCall(DEFAULT_META, [], parseCall({ add: [{ kind: 'goal', text: 'G' }, { kind: 'step', text: 'One' }], }), STAMP)
  const b = applyCall(
    a.meta,
    a.entries,
    parseCall({
      add: [
        { kind: 'nonsense', text: 'refused' },
        { kind: 'step', text: 'One' },
        { kind: 'assumption', text: 'Rests on the duplicate', of: '@2' },
        { kind: 'step', text: 'Two' },
        { kind: 'decision', text: 'Rests on Two', of: '@4' },
        { kind: 'risk', text: 'Forward link', of: '@9' },
      ],
    }),
    STAMP,
  )
  const link = (id: string) => b.entries.find(e => e.id === id)?.of
  expect(link('A1')).toBe('S1')
  expect(link('D1')).toBe('S2')
  expect(b.problems.join(' ')).toContain('no entry @9')
})

test('closed turns are stamped once, cleared on reopen, and drawn as a turns grid', async () => {
  const at = (turn: number) => ({ ...STAMP, turn })
  const a = applyCall(DEFAULT_META, [], parseCall({ add: [{ kind: 'goal', text: 'G' }, { kind: 'step', text: 'One' }, { kind: 'assumption', text: 'Maybe' }] }), at(1))
  let list = withClosedTurns([], a.entries, 1)
  expect(list.every(e => e.closedTurn === null)).toBe(true)
  const b = applyCall(a.meta, list, parseCall({ resolve: [{ id: 'S1', status: 'done' }, { id: 'A1', status: 'invalidated', note: 'nope' }] }), at(3))
  list = withClosedTurns(list, b.entries, 3)
  expect(list.find(e => e.id === 'S1')?.closedTurn).toBe(3)
  const again = withClosedTurns(list, list.map(e => ({ ...e })), 5)
  expect(again.find(e => e.id === 'S1')?.closedTurn).toBe(3)
  const reopened = withClosedTurns(list, list.map(e => (e.id === 'S1' ? { ...e, status: 'open' as const } : e)), 4)
  expect(reopened.find(e => e.id === 'S1')?.closedTurn).toBe(null)

  const grid = buildHistory(list, 4)
  expect(grid.turns).toEqual([1, 2, 3, 4])
  const rowOf = (id: string) => grid.rows.find(r => r.entry.id === id)?.cells.map(c => c.trim()).join('|')
  expect(rowOf('S1')).toBe('○|───|✓|')
  expect(rowOf('A1')).toBe('○|───|✗|')
  expect(buildHistory(list, 4, 2).turns).toEqual([3, 4])
})

test('the SVGs escape entry text, stay bounded and carry the labels', async () => {
  const a = applyCall(
    DEFAULT_META,
    [],
    parseCall({ add: [{ kind: 'goal', text: 'Fix <b>"quotes"</b> & more' }, { kind: 'step', text: 'One', of: '@1' }, { kind: 'assumption', text: 'Maybe', of: '@2' }, { kind: 'decision', text: 'Pick' }] }),
    STAMP,
  )
  const b = applyCall(a.meta, a.entries, parseCall({ resolve: [{ id: 'S1', status: 'done' }, { id: 'A1', status: 'invalidated' }] }), { ...STAMP, turn: 3 })
  const list = withClosedTurns(a.entries, b.entries, 3)
  const tree = graphSvg(buildGraph(list))
  expect(tree.startsWith('<svg')).toBe(true)
  expect(tree).toContain('Fix &lt;b&gt;&quot;quotes&quot;&lt;/b&gt; &amp; more')
  expect(tree).not.toContain('<b>')
  expect(tree).toContain('S1')
  expect(graphAlt(buildGraph(list))).toContain('A1, assumption under S1, invalidated')
  expect(tree).toContain('font-weight="700"')
  const grid = historySvg(buildHistory(list, 3))
  expect(grid).toContain('A1')
  expect(grid.endsWith('</svg>')).toBe(true)
  const many = Array.from({ length: 300 }, (_, i) => ({ kind: 'step', text: `Step number ${i} with a fairly long description to pad the markup` }))
  const big = applyCall(DEFAULT_META, [], parseCall({ add: [{ kind: 'goal', text: 'G' }, ...many] }), STAMP)
  expect(graphSvg(buildGraph(big.entries)).length).toBeLessThan(131072)
  expect(historySvg(buildHistory(big.entries, 3)).length).toBeLessThan(131072)
})

test('the tree shows the reach of an invalidated assumption, the active path, folded branches and unlinked entries', async () => {
  const extra = Array.from({ length: 6 }, (_, i) => ({ kind: 'step', text: `Later ${i}` }))
  const a = applyCall(
    DEFAULT_META,
    [],
    parseCall({
      add: [
        { kind: 'goal', text: 'G' },
        { kind: 'step', text: 'Done parent' },
        { kind: 'step', text: 'Done child one', of: '@2' },
        { kind: 'step', text: 'Done child two', of: '@2' },
        { kind: 'step', text: 'Working on it' },
        { kind: 'assumption', text: 'Wrong guess', of: '@5' },
        { kind: 'step', text: 'Rests on the guess', of: '@6' },
        { kind: 'decision', text: 'Loose decision' },
        ...extra,
      ],
    }),
    STAMP,
  )
  const b = applyCall(a.meta, a.entries, parseCall({ resolve: [{ id: 'S1', status: 'done' }, { id: 'S2', status: 'done' }, { id: 'S3', status: 'done' }, { id: 'S4', status: 'active' }, { id: 'A1', status: 'invalidated' }] }), STAMP)
  const list = b.entries
  const find = (roots: ReturnType<typeof buildGraph>, id: string) => {
    const hit = (n: (typeof roots)[number]): (typeof roots)[number] | null => (n.entry.id === id ? n : n.children.map(hit).find(Boolean) ?? null)
    return roots.map(hit).find(Boolean) ?? null
  }
  const full = buildGraph(list, false)
  expect(find(full, 'S4')?.touched).toEqual(['A1'])
  expect(find(full, 'S5')?.touched).toEqual(['A1'])
  expect(find(full, 'S1')?.touched).toEqual([])
  expect(find(full, 'S4')?.onPath).toBe(true)
  expect(find(full, 'S1')?.onPath).toBe(false)
  expect(find(full, 'A1')?.onDamage).toBe(true)

  const folded = buildGraph(list)
  expect(find(folded, 'S1')?.hidden).toBe(2)
  expect(find(folded, 'S1')?.children.length).toBe(0)
  expect(find(folded, 'S4')?.children.length).toBe(1)
  expect(buildGraph(list.slice(0, 5)).every(r => r.hidden === 0)).toBe(true)

  expect(unlinkedCount(list)).toBe(1)
  expect(touchedTag(['A1', 'A2', 'A3'])).toBe('⚠A1,A2+')
  expect(graphLines(folded).find(l => l.entry.id === 'S4')?.tag).toBe('⚠A1')
  const svg = graphSvg(folded, 480, undefined, 1)
  expect(svg).toContain('class="eb"')
  expect(svg).toContain('⚠A1')
  expect(svg).toContain('not linked into the tree')
  expect(graphAlt(full, 1)).toContain('affected by invalidated A1')
})

test('text is stripped of control and bidi characters and cut by code point, so SVG stays well formed', async () => {
  const dirty = 'a\u0000b\u001b[31m\u202Ec\ud800d\u007f e\u200bf'
  expect(clean(dirty)).toBe('ab[31mcd ef')
  expect(clip('😀😀😀', 2)).toBe('😀…')
  expect(clip('😀😀', 5)).toBe('😀😀')
  expect(clean('x'.repeat(199) + '😀' + 'tail', 200)).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
  expect(esc('<\u0000&\u202E>')).toBe('&lt;&amp;&gt;')
  const a = applyCall(DEFAULT_META, [], parseCall({ add: [{ kind: 'goal', text: 'Goal \u0000\u202E<x>' }, { kind: 'step', text: 'S\u001b' + '😀'.repeat(300) }] }), STAMP)
  const svg = graphSvg(buildGraph(a.entries))
  expect(svg).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e]/)
  expect(svg).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
})

test('ids stay unique when two writers hold the same counter, and counters merge by maximum', async () => {
  const a = applyCall(DEFAULT_META, [], parseCall({ add: [{ kind: 'assumption', text: 'First' }] }), STAMP)
  // A second writer still holding the old counter, but reading the entries the first one wrote.
  const b = applyCall(DEFAULT_META, a.entries, parseCall({ add: [{ kind: 'assumption', text: 'Second' }] }), STAMP)
  expect(b.added[0]?.id).toBe('A2')
  expect(nextId(DEFAULT_META, 'assumption', a.entries).id).toBe('A2')
  expect(mergeMeta(a.meta, b.meta).seq.assumption).toBe(2)
  expect(mergeMeta({ ...DEFAULT_META, reportedAt: 5 }, { ...DEFAULT_META, reportedAt: 3 }).reportedAt).toBe(5)
})

test('parallel ledger calls keep every entry and give each its own id', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const calls = ['One', 'Two', 'Three', 'Four'].map(text => $.tool.call({ tool: TOOL, add: [{ kind: 'assumption', text }] } as never))
  const ran = await Promise.all(calls)
  const ids = ran.map(r => String((r as { result?: unknown }).result).match(/Logged (A\d+)/)?.[1])
  expect(new Set(ids).size).toBe(4)
  const ui = await $.ui.mount({ plugin: 'intent-ledger', surface: 'terminal', component: 'Pane', requestId: 'intent-ledger', props: PANE_PROPS })
  const drawn = JSON.stringify(await ui.drawn())
  for (const text of ['One', 'Two', 'Three', 'Four']) expect(drawn).toContain(text)
  await ui.unmount()
})

test('a repeat is a duplicate only while the first is unsettled and by the same writer; a repeat may add its link', async () => {
  const first = applyCall(DEFAULT_META, [], parseCall({ add: [{ kind: 'step', text: 'Run tests' }, { kind: 'step', text: 'Parent' }] }), STAMP)
  const again = applyCall(first.meta, first.entries, parseCall({ add: [{ kind: 'step', text: 'Run tests', of: 'S2' }] }), STAMP)
  expect(again.entries.length).toBe(2)
  expect(again.entries.find(e => e.id === 'S1')?.of).toBe('S2')
  const done = applyCall(again.meta, again.entries, parseCall({ resolve: [{ id: 'S1', status: 'done' }] }), STAMP)
  const rerun = applyCall(done.meta, done.entries, parseCall({ add: [{ kind: 'step', text: 'Run tests' }] }), STAMP)
  expect(rerun.entries.length).toBe(3)
  const other = applyCall(rerun.meta, rerun.entries, parseCall({ add: [{ kind: 'step', text: 'Run tests' }] }), { ...STAMP, who: 'sub·abc12' })
  expect(other.entries.length).toBe(4)
})

test('trimming keeps the goal, re-parents children of what it drops, and is bounded even when all is open', async () => {
  const base = { why: '', confidence: null, status: 'open' as const, source: 'agent' as const, who: 'main', turn: 1, at: 1, updatedAt: 1, note: '', resolvedBy: null, ref: null, of: null, closedTurn: null }
  const goal = { ...base, id: 'G1', kind: 'goal' as const, text: 'goal', status: 'done' as const }
  const settledParent = { ...base, id: 'S1', kind: 'step' as const, text: 'parent', status: 'done' as const, of: 'G1' }
  const child = { ...base, id: 'A1', kind: 'assumption' as const, text: 'child', of: 'S1' }
  const filler = Array.from({ length: MAX_ENTRIES + 20 }, (_, i) => ({ ...base, id: `S${i + 10}`, kind: 'step' as const, text: `done ${i}`, status: 'done' as const, of: 'G1' }))
  const trimmed = trimEntries([goal, settledParent, child, ...filler])
  expect(trimmed.length).toBeLessThanOrEqual(MAX_ENTRIES)
  expect(trimmed.some(e => e.id === 'G1')).toBe(true)
  const ids = new Set(trimmed.map(e => e.id))
  expect(trimmed.every(e => e.of === null || ids.has(e.of))).toBe(true)

  const allOpen = Array.from({ length: HARD_MAX_ENTRIES + 50 }, (_, i) => ({ ...base, id: `A${i + 1}`, kind: 'assumption' as const, text: `open ${i}` }))
  expect(trimEntries(allOpen).length).toBeLessThanOrEqual(HARD_MAX_ENTRIES)
})

test('user marks are reported once, and a big tree folds to a bound while keeping the active step', async () => {
  const a = applyCall(DEFAULT_META, [], parseCall({ add: [{ kind: 'assumption', text: 'Guess' }] }), { ...STAMP, at: 1000 })
  const marked = a.entries.map(e => ({ ...e, status: 'confirmed' as const, resolvedBy: 'you' as const, updatedAt: 1500 }))
  expect(toolReply({ ...a, added: [], changed: [], problems: [] }, marked, 1000)).toContain('Marked by the user')
  expect(toolReply({ ...a, added: [], changed: [], problems: [] }, marked, 2000)).not.toContain('Marked by the user')

  const steps = Array.from({ length: 60 }, (_, i) => ({ kind: 'step', text: `Step ${i}` }))
  const t = applyCall(DEFAULT_META, [], parseCall({ add: [{ kind: 'goal', text: 'G' }, ...steps] }), STAMP)
  const active = applyCall(t.meta, t.entries, parseCall({ resolve: [{ id: 'S60', status: 'active' }] }), STAMP).entries
  const tree = buildGraph(active)
  const total = (n: (typeof tree)[number]): number => 1 + n.children.reduce((x, c) => x + total(c), 0)
  expect(tree.reduce((x, r) => x + total(r), 0)).toBeLessThanOrEqual(GRAPH_MAX_NODES)
  expect(graphLines(tree).some(l => l.entry.id === 'S60')).toBe(true)
  expect(tree[0]?.hidden).toBeGreaterThan(0)
  expect(buildGraph(active, false)[0]?.children.length).toBe(60)
  const deep = applyCall(DEFAULT_META, [], parseCall({ add: [{ kind: 'goal', text: 'G' }, { kind: 'step', text: 'a' }, { kind: 'step', text: 'b', of: '@2' }, { kind: 'step', text: 'c', of: '@3' }, { kind: 'step', text: 'd', of: '@4' }, { kind: 'step', text: 'e', of: '@5' }, { kind: 'step', text: 'f', of: '@6' }, { kind: 'assumption', text: 'deep', of: '@7' }] }), STAMP)
  expect(unlinkedCount(deep.entries)).toBe(0)
  limitTree([], 1)
})

test('small visuals: progress bar, sparkline, activity, age, freshness, health strip and the fresh bar in the SVG', async () => {
  expect(progressBar(0, 5)).toBe('░░░░░░░░')
  expect(progressBar(2, 5)).toBe('███░░░░░')
  expect(progressBar(1, 100)).toBe('█░░░░░░░')
  expect(progressBar(99, 100)).toBe('███████░')
  expect(progressBar(5, 5)).toBe('████████')
  expect(progressBar(0, 0)).toBe('')
  expect(sparkline([0, 1, 4, 8])).toBe('·▁▄█')
  expect(sparkline([])).toBe('')
  expect(sparkline([0, 0])).toBe('··')
  expect(ageLevel(0, 3)).toBe(0)
  expect(ageLevel(2, 3)).toBe(1)
  expect(ageLevel(3, 3)).toBe(2)
  expect(ageLevel(9, 0)).toBe(0)

  const a = applyCall(DEFAULT_META, [], parseCall({ add: [{ kind: 'goal', text: 'G' }, { kind: 'step', text: 'One' }, { kind: 'assumption', text: 'Maybe' }] }), { ...STAMP, turn: 1 })
  const b = applyCall(a.meta, a.entries, parseCall({ resolve: [{ id: 'S1', status: 'done' }] }), { ...STAMP, at: 5000, turn: 2 })
  const list = withClosedTurns(a.entries, b.entries, 2)
  expect(activityByTurn(list, [1, 2])).toEqual([3, 1])
  const turn = { n: 2, startedAt: 4000, logged: 0, edits: [], isRunning: false }
  expect(list.filter(e => isFresh(e, turn)).map(e => e.id)).toEqual(['S1'])
  expect(isFresh(list[0]!, { ...turn, n: 0 })).toBe(false)
  expect(isFresh(list[0]!, { ...turn, startedAt: 0 })).toBe(false)

  const parts = healthParts({ open: 2, confirmed: 1, invalidated: 1, stale: 1, stepsDone: 2, steps: 5, questions: 1, risks: 1 })
  expect(parts.map(p => p.text)).toEqual(['2 open', '⚠ 1 stale', '✗ 1', '✓ 1', '███░░░░░ 2/5', '? 1', '! 1'])
  expect(healthParts({ open: 0, confirmed: 0, invalidated: 0, stale: 0, stepsDone: 0, steps: 0, questions: 0, risks: 0 })).toEqual([])
  expect(healthParts({ open: 0, confirmed: 0, invalidated: 0, stale: 0, stepsDone: 3, steps: 3, questions: 0, risks: 0 })[0]?.tone).toBe('success')

  const svg = graphSvg(buildGraph(list), 480, undefined, 0, new Set(['S1']))
  expect(svg.match(/rx="1\.5"/g)?.length).toBe(1)
  expect(graphAlt(buildGraph(list, false), 0, new Set(['S1']))).toContain('changed this turn')
  expect(graphSvg(buildGraph(list)).match(/rx="1\.5"/g)).toBe(null)
})

test('a cycle or a dropped parent never loops or resurrects a branch', async () => {
  const a = applyCall(
    DEFAULT_META,
    [],
    parseCall({ add: [{ kind: 'goal', text: 'G' }, { kind: 'step', text: 'One' }, { kind: 'step', text: 'Two', of: 'S1' }] }),
    STAMP,
  )
  const cyc = a.entries.map(e => (e.id === 'S1' ? { ...e, of: 'S2' } : e))
  expect(graphLines(buildGraph(cyc)).length).toBeLessThan(10)
  const dropped = a.entries.map(e => (e.id === 'S1' ? { ...e, status: 'dropped' as const } : e))
  expect(graphLines(buildGraph(dropped)).map(l => l.entry.id)).toEqual(['G1', 'S2'])
})

test('parseCall keeps valid entries and names what it refused', async () => {
  const call = parseCall({
    add: [
      { kind: 'assumption', text: '  Users table has an  email column ', why: 'saw it in schema.sql', confidence: 'high' },
      { kind: 'wish', text: 'nope' },
      { kind: 'step', text: '' },
    ],
    resolve: [{ id: 'a1', status: 'confirmed' }, { id: 'S1' }],
  })
  expect(call.add.length).toBe(1)
  expect(call.add[0]?.text).toBe('Users table has an email column')
  expect(call.resolve[0]?.id).toBe('A1')
  expect(call.problems.length).toBe(3)
})

test('applyCall numbers entries per kind, resolves by id and fits statuses to kinds', async () => {
  const first = applyCall(
    DEFAULT_META,
    [],
    parseCall({
      add: [
        { kind: 'goal', text: 'Add OAuth login' },
        { kind: 'assumption', text: 'Express 4 is in use', confidence: 'medium' },
        { kind: 'assumption', text: 'No auth middleware exists' },
        { kind: 'step', text: 'Add a passport strategy' },
      ],
    }),
    STAMP,
  )
  expect(first.added.map(e => e.id)).toEqual(['G1', 'A1', 'A2', 'S1'])
  expect(first.entries.find(e => e.id === 'G1')?.status).toBe('active')

  const second = applyCall(
    first.meta,
    first.entries,
    parseCall({ resolve: [{ id: 'A1', status: 'done' }, { id: 'A2', status: 'invalidated', note: 'found auth.js' }, { id: 'S1', status: 'active' }, { id: 'X9', status: 'done' }] }),
    { ...STAMP, at: 2000, turn: 2 },
  )
  const byId = (id: string) => second.entries.find(e => e.id === id)
  expect(byId('A1')?.status).toBe('confirmed')
  expect(byId('A2')?.status).toBe('invalidated')
  expect(byId('A2')?.note).toBe('found auth.js')
  expect(byId('S1')?.status).toBe('active')
  expect(second.problems).toEqual(['no entry X9'])

  const reply = toolReply(second, second.entries)
  expect(reply).toContain('Updated A1 → confirmed')
  expect(reply).toContain('Not recorded: no entry X9')
})

test('the same text logged twice is one entry', async () => {
  const once = applyCall(DEFAULT_META, [], parseCall({ add: [{ kind: 'assumption', text: 'Node 22' }] }), STAMP)
  const twice = applyCall(once.meta, once.entries, parseCall({ add: [{ kind: 'assumption', text: 'Node 22' }] }), STAMP)
  expect(twice.entries.length).toBe(1)
})

test('fitStatus maps near misses and refuses nonsense', async () => {
  expect(fitStatus('assumption', 'done')).toBe('confirmed')
  expect(fitStatus('step', 'confirmed')).toBe('done')
  expect(fitStatus('decision', 'answered')).toBe(null)
})

test('stale assumptions and the status line', async () => {
  const a = applyCall(DEFAULT_META, [], parseCall({ add: [{ kind: 'assumption', text: 'CI runs on push' }, { kind: 'step', text: 'Write tests' }] }), STAMP)
  expect(countsOf(a.entries, 1, 3).stale).toBe(0)
  expect(countsOf(a.entries, 4, 3).stale).toBe(1)
  expect(statusLine(a.entries, 4, 3)).toBe('ledger · 1 open assumption · 1 stale · plan 0/1')
  expect(statusLine([], 1, 3)).toBe(undefined)
})

test('a todo list is mirrored as observed steps, and a todo it drops is dropped', async () => {
  const one = syncTodos(DEFAULT_META, [], [
    { content: 'Read routes', status: 'completed' },
    { content: 'Add strategy', status: 'in_progress' },
    { content: 'Write tests', status: 'pending' },
  ], { ...STAMP, source: 'observed' })
  expect(one.entries.map(e => e.status)).toEqual(['done', 'active', 'open'])
  expect(one.summary).toBe('todo list updated · 1/3 done')
  const two = syncTodos(one.meta, one.entries, [{ content: 'Read routes', status: 'completed' }, { content: 'Add strategy', status: 'completed' }], { ...STAMP, source: 'observed' })
  expect(two.entries.find(e => e.text === 'Write tests')?.status).toBe('dropped')
  expect(two.entries.find(e => e.text === 'Add strategy')?.status).toBe('done')
})

// ---------------------------------------------------------------- through the engine

test('the ledger tool records entries and the pane draws them on every surface that docks', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const ran = await $.tool.call({
    tool: TOOL,
    add: [
      { kind: 'goal', text: 'Add OAuth login to the API' },
      { kind: 'assumption', text: 'Users table has an email column', why: 'schema.sql', confidence: 'high' },
      { kind: 'decision', text: 'Use passport over a hand-rolled JWT', why: 'fewer moving parts' },
      { kind: 'finding', text: 'Pane has no background option', why: 'claude-code.d.ts' },
      { kind: 'step', text: 'Wire passport strategy' },
    ],
  } as never)
  expect(String((ran as { result?: unknown }).result)).toContain('Logged G1, A1, D1, F1, S1')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'intent-ledger', surface, component: 'Pane', requestId: 'intent-ledger', props: PANE_PROPS })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('Add OAuth login to the API')
    expect(drawn).toContain('Users table has an email column')
    expect(drawn).toContain('Use passport over a hand-rolled JWT')
    expect(drawn).toContain('FINDINGS')
    // What needs a decision comes before the diagrams.
    expect(drawn.indexOf('ASSUMPTIONS')).toBeLessThan(drawn.indexOf('PLAN'))
    expect(drawn.indexOf('PLAN')).toBeLessThan(drawn.indexOf('STRUCTURE'))
    expect(drawn.indexOf('STRUCTURE')).toBeLessThan(drawn.indexOf('TIMELINE'))
    expect(drawn).toContain('press a row to read it in full, confirm or correct it')
    expect(drawn).toContain('1 open')
    expect(drawn).toContain('░')
    expect(drawn).toContain('STRUCTURE')
    // The terminal draws the tree as text; the remote surfaces draw it as an SVG.
    expect(drawn).toContain(surface === 'terminal' ? '└─' : '<svg')
    expect(drawn).not.toContain('HISTORY')
    expect(drawn).toContain('Pane has no background option')
    await ui.unmount()
  }
})

test('headers take the terminal colour unless brandAccent is on', async ($, on) => {
  mock.clock(on, { now: 1000 })
  await $.tool.call({ tool: TOOL, add: [{ kind: 'goal', text: 'Ship it' }] } as never)
  const ui = await $.ui.mount({ plugin: 'intent-ledger', surface: 'terminal', component: 'Pane', requestId: 'intent-ledger', props: PANE_PROPS })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('GOAL')
  expect(drawn).not.toContain('"color":"claude"')
  await ui.unmount()
})

test('brandAccent colours the headers', { options: { brandAccent: true } }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  await $.tool.call({ tool: TOOL, add: [{ kind: 'goal', text: 'Ship it' }] } as never)
  const ui = await $.ui.mount({ plugin: 'intent-ledger', surface: 'terminal', component: 'Pane', requestId: 'intent-ledger', props: PANE_PROPS })
  expect(JSON.stringify(await ui.drawn())).toContain('"color":"claude"')
  await ui.unmount()
})

test('parseConfig defaults brandAccent off and reads it when set', async () => {
  expect(parseConfig(undefined).brandAccent).toBe(false)
  expect(parseConfig({ brandAccent: true }).brandAccent).toBe(true)
  expect(parseConfig({ brandAccent: 'yes' }).brandAccent).toBe(false)
})

test('palettes: config reads a known id, text colours switch to hex, SVGs take the palette', async () => {
  expect(parseConfig(undefined).palette).toBe('default')
  expect(parseConfig({ palette: 'dracula' }).palette).toBe('dracula')
  expect(parseConfig({ palette: 'not-a-theme' }).palette).toBe('default')
  expect(parseConfig({ palette: 7 }).palette).toBe('default')
  expect(termColors(paletteOf('default'), false).success).toBe('success')
  expect(termColors(paletteOf('default'), true).accent).toBe('claude')
  expect(termColors(paletteOf('dracula'), false).success).toBe('#50fa7b')
  for (const p of PALETTES) {
    for (const key of ['bg', 'border', 'text', 'dim', 'edge', 'surface', 'ok', 'bad', 'warn', 'active', 'off', 'accent'] as const) {
      expect(p[key]).toMatch(/^#[0-9a-f]{6}$/i)
    }
  }
  const a = applyCall(DEFAULT_META, [], parseCall({ add: [{ kind: 'goal', text: 'G' }, { kind: 'step', text: 'One' }] }), STAMP)
  expect(graphSvg(buildGraph(a.entries), 480, paletteOf('dracula'))).toContain('#282a36')
  expect(graphSvg(buildGraph(a.entries), 480, paletteOf('catppuccin-latte'))).toContain('#eff1f5')
  expect(historySvg(buildHistory(a.entries, 2), paletteOf('nord'))).toContain('#2e3440')
})

test('every palette is legible on its own background, whatever the source colours were', async () => {
  for (const { id } of PALETTES) {
    const p = paletteOf(id)
    const need = (name: string, a: string, b: string, min: number) => expect(`${id} ${name} ${contrast(a, b) >= min}`).toBe(`${id} ${name} true`)
    need('text', p.text, p.bg, 4.5)
    need('dim', p.dim, p.bg, 4.5)
    need('edge', p.edge, p.bg, 3)
    for (const key of ['ok', 'bad', 'warn', 'active', 'off', 'accent'] as const) need(key, p[key], p.bg, 3)
    for (const key of ['ok', 'bad', 'warn', 'active', 'off'] as const) need(`mark on ${key}`, markOn(p[key], p), p[key], 4.5)
  }
  expect(paletteOf('  Dracula ').id).toBe('dracula')
  expect(paletteOf(undefined).id).toBe('default')
  expect(parseConfig({ palette: ' Catppuccin-Mocha ' }).palette).toBe('catppuccin-mocha')
})

test('/ledger status text names the version and the palette in use', async () => {
  const text = statusText(parseConfig({ palette: 'nord' }))
  expect(text).toContain(`Intent Ledger ${VERSION}`)
  expect(text).toContain('palette: nord')
  expect(statusText(parseConfig(undefined))).toContain('follows your Claude Code theme')
})

test('a chosen palette colours the terminal pane in hex', { options: { palette: 'dracula' } }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  await $.tool.call({ tool: TOOL, add: [{ kind: 'goal', text: 'Ship it' }, { kind: 'assumption', text: 'Maybe' }] } as never)
  const ui = await $.ui.mount({ plugin: 'intent-ledger', surface: 'terminal', component: 'Pane', requestId: 'intent-ledger', props: PANE_PROPS })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('#bd93f9')
  expect(drawn).not.toContain('"color":"warning"')
  await ui.unmount()
})

test('confirming an assumption from the pane reaches the next ledger result', async ($, on) => {
  mock.clock(on, { now: 1000 })
  await $.tool.call({ tool: TOOL, add: [{ kind: 'assumption', text: 'Tests run with vitest' }] } as never)
  const ui = await $.ui.mount({ plugin: 'intent-ledger', surface: 'terminal', component: 'Pane', requestId: 'intent-ledger', props: PANE_PROPS })
  await ui.press({ key: 'row:A1' })
  await ui.press({ key: 'ok:A1' })
  expect(JSON.stringify(await ui.drawn())).toContain('by you')
  await ui.unmount()
  const ran = await $.tool.call({ tool: TOOL, add: [{ kind: 'step', text: 'Run the suite' }] } as never)
  expect(String((ran as { result?: unknown }).result)).toContain('Marked by the user in the pane: A1 confirmed')
})

test('questions, risks, decisions, findings and steps open to their full text from the pane', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const long = 'Does the staging database allow the migration to run twice without losing rows that were written during the first attempt?'
  await $.tool.call({ tool: TOOL, add: [{ kind: 'question', text: long }, { kind: 'risk', text: 'Short risk', why: 'seen in CI' }, { kind: 'decision', text: 'Keep the old index', why: 'a rebuild locks the table for most of the afternoon while traffic is high' }] } as never)
  const ui = await $.ui.mount({ plugin: 'intent-ledger', surface: 'terminal', component: 'Pane', requestId: 'intent-ledger', props: { ...PANE_PROPS, bodyColumns: 40 } })
  expect(JSON.stringify(await ui.drawn())).not.toContain(`"${long}"`)
  await ui.press({ key: 'row:Q1' })
  const open = JSON.stringify(await ui.drawn())
  expect(open).toContain(`"${long}"`)
  await ui.press({ key: 'row:D1' })
  const second = JSON.stringify(await ui.drawn())
  expect(second).toContain('"a rebuild locks the table for most of the afternoon while traffic is high"')
  expect(second).not.toContain(`"${long}"`)
  await ui.unmount()
})

test('the inline layout is a short summary', async ($, on) => {
  mock.clock(on, { now: 1000 })
  await $.tool.call({ tool: TOOL, add: [{ kind: 'goal', text: 'Fix the flaky build' }, { kind: 'assumption', text: 'The cache key is wrong' }] } as never)
  const ui = await $.ui.mount({ plugin: 'intent-ledger', surface: 'terminal', component: 'Pane', requestId: 'intent-ledger', props: { ...PANE_PROPS, placement: 'inline' as const } })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Fix the flaky build')
  expect(drawn).toContain('1 open')
  expect(drawn).not.toContain('TIMELINE')
  await ui.unmount()
})
