# Contributing

Thanks for looking. Small fixes and focused features are welcome.

## Setup

There is no build step or package.json. The `claude-code` and `claude-code/testing` modules are provided by Claude Code 2.1.296+.

```
claude --plugin-dir .      # run a session with the mod loaded; edits hot-reload
claude plugin validate .   # check manifest and layout
claude plugin test .       # run tests/ledger.test.ts
```

To iterate on one test, temporarily use `test.only` in `tests/ledger.test.ts` and remove it before committing.

## Layout

- `hooks/core.ts` is pure (reducers, validation, graph and SVG builders, Markdown export); `hooks/palettes.ts` is the colour data. Keep it free of host imports so it can be tested directly.
- `hooks/register.tsx` is the host layer: tool, system-prompt section, observers, `/ledger`, status line, pane.
- `types/index.d.ts` is the state contract. Change it first when altering state shape, and update the `normalize*` functions so stored state still loads.
- `.claude-plugin/plugin.json` options must stay in sync with `parseConfig` in `hooks/core.ts` and the README table.

## Ground rules

Every change to the entries goes through `mutate` in `register.tsx` (one atomic update); text from the agent goes through `clean` before it is stored and `esc` before SVG.

The ledger is built only from what the agent states openly. It must not read hidden reasoning, make network calls, spawn processes, touch files or call a model.

## Pull requests

`main` is protected: open a pull request from a branch; it merges by squash once the `manifests` check passes and conversations are resolved.

- New behaviour in `core.ts` gets a pure test; tool and pane wiring gets an engine test.
- Run `claude plugin validate .` and `claude plugin test .` first.
- Update README and CHANGELOG when behaviour or options change, and bump `version` in `plugin.json` and `VERSION` in `hooks/core.ts` (CI checks they match): installed copies are cached by version, so an unbumped change never reaches an update.
- Say which surface you tried it on (terminal inline, terminal docked, desktop).

Bugs and ideas: open an issue using the templates.
