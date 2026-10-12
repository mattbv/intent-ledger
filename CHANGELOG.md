# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are the `version` in `.claude-plugin/plugin.json`. Everything up to 0.4.5 was released on 2026-10-11.

## [0.5.1]
### Fixed
- The timeline no longer shows the `<pasted_content>` tags Claude Code puts around pasted text in your prompts.

## [0.5.0]
### Added
- A `motion` option (on by default): while the agent is working, the `▸ NOW` line and the active plan step show a small spinner instead of `▸`. It moves about twice a second, only on the terminal and only while a turn runs, and stops when the turn ends. Turn it off to keep the plain marker.

## [0.4.10]
### Changed
- The timeline entry for an approved plan no longer starts with the plan's `#` heading mark.

### Docs
- The README and CLAUDE.md now say the ledger is kept across `claude --resume` (seen in a hand test) and reset by `/clear`.

## [0.4.9]
### Changed
- An opened approved plan wraps long lines instead of cutting them, and shows its headings in bold without the `#` marks.
- The health strip says `3 open assumptions` instead of `3 open`, to tell them apart from questions and risks.

## [0.4.8]
### Changed
- The History header no longer carries a sparkline. The terminal grid has a `changes` row instead, with the number of entries logged or settled in each turn.

## [0.4.7]
### Changed
- The Plan header is followed by `+N more steps to do` when steps are not listed.
- The health strip says `2 questions · 1 risk` instead of `? 2 · ! 1`.
- In the terminal, the Structure tree leaves out plain assumption, question, risk, decision and finding leaves once it passes 8 nodes (they are listed above); wrong ones, damaged branches and the active path stay.
- An opened row no longer repeats text that already fit on its line, and its last line reads `logged T3 · by <agent>`.

## [0.4.6]
### Changed
- Open questions, risks, decisions, findings and plan steps are now pressable rows like assumptions: a cut-off line shows `▸`, and pressing it shows the full text, the reason and note, and the turn.
- The `▸ NOW` line and the timeline wrap instead of being cut off.
- The progress bar uses `█`/`░` instead of `▰`/`▱`, which many terminal fonts draw too wide and leave a gap before the count.

## [0.4.5]
### Added
- A health strip under the goal: open and stale assumptions, invalidated and confirmed ones, a plan progress bar, open questions and risks.
- A left-gutter `▎` marks entries added or changed since your last prompt (and a bar on the SVG tree).
- Confidence shown as a small bar, open assumptions turn amber as they near going stale, and a sparkline of activity per turn in the History header.
- A plan progress bar in the Plan header; `docs/recording-a-demo.md` describes how to record a demo.

## [0.4.4]
### Added
- `/ledger status` prints the loaded version and the settings that shape the pane, to tell which version is running.

### Fixed
- Every palette is now legible on its own background: dim text, lines and status colours are nudged until they reach 4.5:1 (text) or 3:1 (lines, status colours), and SVG marker glyphs pick black, white or the palette's own colour per status colour, so the light Catppuccin Latte and several dark palettes no longer have faint or unreadable parts. A test checks every palette.
- The `palette` option ignores case and stray spaces.

### Docs
- How to update (`claude plugin update intent-ledger@intent-ledger`, then restart), troubleshooting for an old version being loaded, and a note that named palettes expect a matching terminal theme.

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
