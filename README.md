# Intent Ledger

A Claude Code mod that keeps a live ledger of **what the agent is aiming for, what it is assuming, what it plans to do and what it has decided**, in a pane beside the transcript, so you can monitor its intent across a long session and catch a wrong assumption before it turns into wrong code.

Where [Flightdeck](https://github.com/scasella/claude-flightdeck) shows what the agent *did* (cost, tools, permissions, subagents), Intent Ledger shows what it *meant*.

## Install

From GitHub:

```
/plugin install intent-ledger --marketplace mattbv/intent-ledger
```

Answer `y` to add the marketplace, pick a scope, then run `/ledger`.

Or load it from a local folder for one session:

```
claude --plugin-dir ./intent-ledger
```

Requires Claude Code 2.1.296 or later (mods are early access; the API can change between releases).

## What you see

```
GOAL
Add OAuth login to the API

ASSUMPTIONS  2 open · 1 ✓ · 1 ✗ · 1 stale
? A3 Sessions can live in memory for now        low · T4
? A1 Users table has an email column    high · T1 · stale
✗ A2 No auth middleware exists yet        T1 · by you
✓ A4 Express 4.x is in use                     medium · T2

PLAN  2/5 done
✓ Read the routes
▸ Add a passport strategy
· Wire the callback route
· Write integration tests                          todo
◆ approved plan · T2 · show

DECISIONS
D1 Use passport over a hand-rolled JWT — fewer moving parts

STRUCTURE
◎ G1 Add OAuth login to the API
├─ ✓ S1 Read the routes
└─ ▸ S2 Add a passport strategy
   ├─ · S3 Wire the callback route
   └─ ? A3 Sessions can live in memory for now

HISTORY  T1–T4
                       1  2  3  4
S1 Read the routes     ○ ───  ✓
A1 Express 4.x         ○ ───  ✗
S2 Add a passport…        ○ ─── ───

FINDINGS
• F1 Pane has no background option — claude-code.d.ts

OPEN QUESTIONS & RISKS
? Q1 Should refresh tokens be rotated?
! R1 The callback URL differs between staging and prod

TIMELINE
T4 you  also add logout
T4 main + A3 Sessions can live in memory for now
T4 main A2 open → invalidated — found middleware/auth.js
T5 main changed 3 files with nothing logged (routes.ts, …)

7 files touched · unlogged changes in T5
```

| Section | Shows |
| --- | --- |
| **Goal** | the latest active goal the agent logged |
| **Assumptions** | each with status (`?` open, `✓` confirmed, `✗` invalidated), confidence, the turn it was logged, and a **stale** flag when it has gone unverified for N turns. Open ones sort first |
| **Plan** | logged steps plus your agent's todo list / task list, read automatically; the plan you approved in plan mode, expandable |
| **Decisions** | choices between alternatives, with the reason |
| **Structure** | a tree of the goal, its steps (and sub-steps), and the assumptions, decisions, findings, questions and risks the agent linked to them with `of` (an id, or `@N` for the Nth entry of the same call). Unlinked steps hang off the goal; other unlinked entries stay in their own sections |
| **History** | entries against turns: `○` the turn one was logged, `───` while it stayed open, `✓` `✗` `×` the turn it settled (done or confirmed, invalidated, dropped). Shown once entries span two turns |
| **Structure marks** | `⚠A1` on every node above or below an invalidated assumption (and a red edge on the path to it), a bold path from the goal to the active step, finished branches folded to `(+n)` once the tree passes 12 nodes, and an "n unlinked" count for entries the agent did not link |
| **Findings** | facts the agent learned that settle no assumption (a limit, a cause, a surprise), with where it saw them |
| **Open questions & risks** | what the agent is deferring or guessing on |
| **Timeline** | your prompts, every entry logged or resolved, and a warning when a turn **changed files with nothing logged** |

Inline (main-screen terminal), the pane collapses to a few-row summary: goal, assumption counts, the active step and the last few moments. The status line reads e.g. `ledger · 2 open assumptions · 1 stale · 1 ✗ · plan 2/5`.

The pane leads with what needs your attention: the goal and the active step (`▸ NOW`), then open assumptions, questions and risks, with the structure and history diagrams below. Stale assumptions carry a `stale` badge ahead of the claim, so it survives a narrow pane. Rows that open show `▸` / `▾`.

On the desktop app, VS Code and mobile, the Structure and History sections are drawn as SVG diagrams (a dark card, so they read on any theme); the terminal draws the same data as text.

### Steering from the pane

Focus the pane (`ctrl+x tab`) and press an assumption to expand it: its reasoning, the note that resolved it, and three buttons:

- **✓ confirm** marks it confirmed by you.
- **✗ wrong** marks it invalidated and drafts a correction in *your* prompt box (`Assumption A2 ("…") is wrong: `). You finish and send it; nothing is sent for you.
- **reopen** sets it back to open.

Your marks also appear in the agent's next ledger result, so it can reconcile its plan.

## Where the data comes from

The ledger is built only from things the agent produces openly:

1. **The ledger tool** (`mcp__intent-ledger__ledger`). The mod registers it and adds a short system-prompt section asking the agent to log its goal, assumptions (with why and confidence), steps, decisions, questions, risks and findings when it starts a multi-step task, and to resolve them as it learns. Turn this off with `instructAgent: false` if you only want observed plans.
2. **Visible plan signals**: `TodoWrite`, `TaskCreate` / `TaskUpdate`, and the plan returned by `ExitPlanMode`.
3. **Edits** (`Edit`, `Write`, `NotebookEdit`) for the footprint and the "changed files with nothing logged" warning.

It does not read the model's hidden reasoning. What you see is what the agent chose to state, plus what it visibly did, so treat the ledger as the agent's declared intent. The "nothing logged" warning is there precisely to show where declared intent and actual changes diverge.

## What it can reach

It makes no network requests, runs no processes, reads and writes no files, and calls no model. State lives in the session (`$.state`) and ends with it. The only things it adds to the conversation are its tool, the system-prompt section, and the tool's own results. With `autoAllow` on, calls to its own ledger tool skip the permission prompt (the tool only writes to the pane); every other tool's permissions are untouched.

## Commands

| Command | Does |
| --- | --- |
| `/ledger` | open the pane |
| `/ledger close` | close it |
| `/ledger reset` | clear the ledger |
| `/ledger copy` | copy the whole ledger as Markdown (shown in the transcript if no clipboard) |

`/clear` resets it along with the conversation.

## Configure

In `/config`, or under `pluginConfigs["intent-ledger"].options` in `settings.json`:

| Option | Default | Meaning |
| --- | --- | --- |
| `instructAgent` | `true` | add the system-prompt section asking the agent to keep the ledger |
| `autoAllow` | `true` | the ledger tool skips the permission prompt |
| `observePlans` | `true` | fold todo lists, tasks and approved plans into the plan |
| `staleAfterTurns` | `3` | flag an open assumption stale after this many turns (`0` disables) |
| `openOnStart` | `true` | open the pane when a session starts (wide terminals, desktop) |
| `palette` | `default` | colours for the pane text and diagrams: `default` follows your Claude Code theme; or `catppuccin-mocha`, `catppuccin-latte`, `dracula`, `gruvbox-dark`, `tokyo-night`, `nord`, `solarized-dark`, `rose-pine` (fixed hex colours, so they also apply when your terminal supports true colour) |
| `brandAccent` | `false` | colour the pane headers in Claude orange; off, they use your terminal's own text colour |
| `statusLine` | `true` | show the summary in the status line |

## How it works

| File | Holds |
| --- | --- |
| `hooks/register.tsx` | the hooks: tool registration, system-prompt section, plan observation, turn bookkeeping, the pane |
| `hooks/core.ts` | pure reducers, input validation, status mapping, summaries and the Markdown export |
| `types/index.d.ts` | the state contract |
| `tests/ledger.test.ts` | pure behaviour, plus the tool and pane exercised through the engine on terminal and desktop |

## Develop

```
claude --plugin-dir .      # edits hot-reload
claude plugin validate .
claude plugin test .
```

## License

MIT
