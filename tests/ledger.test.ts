import { expect, mock, test } from 'claude-code/testing'

import {
  DEFAULT_META,
  TOOL,
  applyCall,
  countsOf,
  fitStatus,
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
    ],
  } as never)
  expect(String((ran as { result?: unknown }).result)).toContain('Logged G1, A1, D1')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'intent-ledger', surface, component: 'Pane', requestId: 'intent-ledger', props: PANE_PROPS })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('Add OAuth login to the API')
    expect(drawn).toContain('Users table has an email column')
    expect(drawn).toContain('Use passport over a hand-rolled JWT')
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
