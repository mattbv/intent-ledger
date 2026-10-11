import { expect, mock, test } from 'claude-code/testing'

import {
  DEFAULT_META,
  TOOL,
  applyCall,
  countsOf,
  buildGraph,
  buildHistory,
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
    expect(drawn).toContain('STRUCTURE')
    expect(drawn).toContain('└─')
    expect(drawn).not.toContain('HISTORY')
    expect(drawn).toContain('Pane has no background option')
    await ui.unmount()
  }
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
