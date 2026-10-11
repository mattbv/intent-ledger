# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are the `version` in `.claude-plugin/plugin.json`. Everything up to 0.4.3 was released on 2026-10-11.

## [0.4.3]
### Changed
- Documentation corrected against the code: the README now matches the real pane order, row format and commands; option descriptions mention risks, findings, the default-palette scope of `brandAccent` and the `instructAgent` dependency of the "nothing logged" warning.
- Agent instructions say "obsolete" steps (not "stale"), ask the agent to close finished goals, and say pane marks are reported once.
- "Wrong" button, toast and docs all say it drafts a reply.
- Added CHANGELOG, CONTRIBUTING, SECURITY, issue and PR templates and a manifest check workflow.

## [0.4.2]
### Fixed
- Parallel tool calls no longer overwrite each other or mint the same id twice: every entry change is one atomic update, counters merge by maximum, and new ids skip ones already taken.
- Text from the agent is stripped of control characters, bidi overrides, zero-width marks and lone surrogates, and cut by code point, so SVG stays well-formed and terminal escapes do not reach the pane.
- Re-logging finished work creates new work instead of being swallowed as a duplicate, and one writer's entry no longer merges into another's. A repeat can supply a missing `of`.
- Trimming keeps the current goal, re-parents children of dropped entries, and is bounded even when everything is open.
- Your pane marks are reported to the agent once, not in every later result.
- The structure tree is bounded to 30 nodes (extra leaves fold into `(+n)`, the active path last), entries past the depth cap no longer count as "unlinked", and one agent's todos no longer edit another's steps.

## [0.4.1]
### Added
- Structure tree: `⚠A1` marks on every node above or below an invalidated assumption (and a red edge on SVG surfaces), a bold path to the active step, finished branches folded to `(+n)` past 12 nodes, and an "n unlinked" count.

## [0.4.0]
### Added
- `palette` option: Catppuccin (mocha, latte), Dracula, Gruvbox, Tokyo Night, Nord, Solarized, Rosé Pine.

## [0.3.2]
### Changed
- Pane headers use the terminal's own text colour by default; the new `brandAccent` option restores Claude orange.

## [0.3.1]
### Changed
- Attention-first section order (goal and now, assumptions, questions, plan, then the diagrams), expand markers and a hint on assumption rows, `stale` as a badge before the claim, status glyphs in the SVGs.

## [0.3.0]
### Added
- Structure and History drawn as SVG on the desktop app, VS Code and mobile.
- History grid: entries against turns.
- `of: "@N"` links to the Nth entry of the same call.

## [0.2.0]
### Added
- Structure graph: a goal and step tree with entries linked through `of`.
- The `finding` entry kind and its pane section.

## [0.1.0]
### Added
- Ledger tool, assumptions with confidence and staleness, plan, decisions, questions and risks, timeline, `/ledger` command and status line.
