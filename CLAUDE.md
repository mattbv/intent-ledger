# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code **mod** (plugin, requires Claude Code 2.1.296+, early-access API) that shows a live pane of the agent's declared intent: goal, assumptions, plan, decisions, questions/risks and a timeline. See `README.md` for the user-facing feature set and config options.

There is no build step, package.json or bundler. The code is TypeScript/TSX loaded directly by Claude Code; the `claude-code` and `claude-code/testing` modules are provided by the host, not installed.

## Commands

```
claude --plugin-dir .      # run a session with the mod loaded; edits hot-reload
claude plugin validate .   # validate the manifest and layout
claude plugin test .       # run tests/ledger.test.ts
```

There is no documented single-test flag; to iterate on one case, narrow it temporarily with `test.only` in `tests/ledger.test.ts`.

## Architecture

- `.claude-plugin/plugin.json` declares the plugin, its `userConfig` options (these must stay in sync with `parseConfig` in `hooks/core.ts` and the README table) and `"types": "./types/index.d.ts"`. `marketplace.json` makes the folder installable as its own marketplace.
- `hooks/hooks.json` only lists the module entry point: `./register.tsx`.
- `hooks/core.ts` is **pure**: reducers (`applyCall`, `syncTodos`, `markByYou`, ...), input validation (`parseCall`, `normalize*`), status/summary helpers and `toMarkdown`. It must stay free of host imports so it can be unit-tested directly.
- `hooks/register.tsx` is the host-facing layer: registers the `mcp__intent-ledger__ledger` tool (auto-allowed by a `tool.check` hook when `autoAllow` is on), the system-prompt section (`INSTRUCTIONS`), observers for `TodoWrite` / `TaskCreate` / `TaskUpdate` / `ExitPlanMode` / edit tools, per-turn bookkeeping, the `/ledger` command, status line and the pane UI. It wires `core.ts` functions to atoms (`atom`, `read`, `update`).
- `hooks/palettes.ts` is pure colour data (`palette` option) plus the contrast helpers: `paletteOf` returns a copy with dim text, lines and status colours nudged to stay legible on the palette's own background (`legible`), and `markOn` picks the marker glyph colour per status colour. `termColors` and the SVG builders in `core.ts` take a palette. A test checks every palette's contrast.
- `VERSION` in `hooks/core.ts` must equal `version` in `plugin.json` (CI checks); `/ledger status` prints it.
- `types/index.d.ts` is the shared state contract (`Entry`, `Status`, `Moment`, `Turn`, `Footprint`, `View`, ...). Change it first when altering state shape, and update the `normalize*` functions so previously stored state still loads (`SCHEMA_VERSION`).

### Invariants worth knowing

- The ledger is built only from what the agent states openly (its tool calls, visible plans, edits). It never reads hidden reasoning and never makes network calls, spawns processes, touches files or calls a model. Keep it that way.
- `Entry.of` links an entry to what it serves (an id, or `@N` for the Nth entry of the same `add` list, resolved in `applyCall`); `Entry.closedTurn` is stamped by `withClosedTurns` at every site in `register.tsx` that writes entries. `buildGraph`/`graphLines`/`buildHistory` and the SVG builders (`graphSvg`, `historySvg`) are pure and live in `core.ts`; the pane uses Svg only when `e.surface !== 'terminal'`.
- Every change to the entries goes through `mutate` in `register.tsx` (one `update` that reads the latest list; counters merge by maximum and `nextId` skips taken ids), so parallel tool calls cannot overwrite each other. Text from the agent passes through `clean`/`stripUnsafe` before it is stored, and `esc` before it reaches SVG.
- In `register.tsx` the JSX factory is the global `h`: never name a variable, parameter or loop variable `h` there (it silently breaks the pane's render, which then reports "no implementation for ui.render").
- State lives in session state (`$.state`) and dies with the session; `/clear` resets it.
- Entry `source` is `agent` | `observed` | `you`. User marks from the pane (confirm / wrong / reopen) are surfaced back to the agent once, in its next ledger tool result (`Meta.reportedAt`), and "wrong" only drafts text in the user's prompt box; nothing is sent automatically.
- Status vocabulary differs per kind (see the `Status` doc comment in `types/index.d.ts`).
- "Changed files with nothing logged" compares edit footprint against ledger activity per turn.

## Tests

`tests/ledger.test.ts` has two layers: pure tests importing from `hooks/core`, and engine-driven tests (using `mock` from `claude-code/testing`) that exercise the tool and pane on both terminal and desktop. New behaviour in `core.ts` should get a pure test; pane/tool wiring goes in the engine layer.
