# CLAUDE.md

## Commands

```bash
npm run verify      # typecheck + test. This is the gate — it must pass before you finish.
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run build       # tsc -p tsconfig.build.json
```

`npm run verify` is the single command that matters. CI runs exactly it.

## Domain

See [CONTEXT.md](./CONTEXT.md). Read it before adding a rule — especially the *role vs.
ManifestType* section and the three rule classes.

## Adding a rule

1. Create `src/rules/<rule-id>.ts` with a default export of `defineRule({ ... })`.
2. Import it in `src/rules/index.ts` and append it to the `rules` array, keeping the array
   ordered by rule id.
3. Add `tests/rules/<rule-id>.test.ts` covering at least one passing and one failing manifest.
4. If you need a new fixture, add it under `tests/fixtures/` following the existing
   `<Publisher>.<Package>/<Version>/` layout.

Rule ids are kebab-case, stable, and never renamed once merged — they appear in user output.

## Conventions

- **Rules are pure.** No I/O, no network, no clock reads. See CONTEXT.md for why this is load-bearing.
- **Rules return diagnostics.** Never `console.log`, never `throw`, never `process.exit`.
- Prefer `positionOf(file, path)` over hand-computed line numbers.
- TypeScript is strict, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
  With the latter, build optional properties conditionally
  (`...(x === undefined ? {} : { x })`) rather than assigning `undefined`.
- Relative imports use the `.js` extension — this is NodeNext ESM, even in `.ts` source.
- Test files live in `tests/`, mirroring `src/`.

## Line endings

Authored on Windows, executed on Linux CI. `.gitattributes` normalises everything to LF.
Do not add files that defeat it, and do not commit a `.editorconfig` that disagrees with it.

## Agent skills

Per-repo config for the `mattpocock/skills` engineering skills, read by `/triage`, `/to-tickets`,
`/to-spec` and `/wayfinder`. These skills are run **locally, by a human** — the `agent-*` CI
workflows do not load them, and nothing here changes the gate above.

### Issue tracker

GitHub Issues in `jeffwlawson/winget-manifest-lint`, via the `gh` CLI.
See [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md).

### Triage labels

The five canonical roles, kept at their default strings. They are a separate vocabulary from the
`agent:*` workflow labels, and `ready-for-agent` → `agent:implement` is human-gated by design.
See [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md).

### Ticket shape

`/to-tickets` publishes a batch as a **parent PRD with native sub-issues**, not as flat peers: the
`/to-spec` output becomes the parent's body, and each slice becomes a sub-issue of it
(`gh issue create --parent`).

- **Create the sub-issues in dependency order, blockers first.** `agent-implement-prd.yml` targets
  the first still-open sub-issue *in sub-issues API order* and never reads `blocked-by`, so
  creation order **is** execution order. The right shape in the wrong order runs slices before
  their blockers, and nothing catches it.
- **Give siblings native `blocked-by` edges as well** (`gh issue create --blocked-by`, needs
  `gh` >= 2.94.0) — the record of why the order is what it is.
- **No ticket in the batch gets an `agent:*` label** — parent and slices alike carry
  `ready-for-agent` and nothing else. A **human** later adds `agent:implement` to the parent
  alone, and that one label starts the whole chain.
- **Verify natively before labelling anything.** Re-read parent, children and edges through the
  API (`gh issue view --json subIssues` / `--json parent,blockedBy,labels`). `/to-tickets` does not
  reliably emit native relations, and a prose `Blocked by:` line is invisible to every consumer.

Its slicing judgement is kept in full — only the publish target and the ordering change.
See [`docs/agents/ticket-shape.md`](./docs/agents/ticket-shape.md).

### Domain docs

Single-context: [CONTEXT.md](./CONTEXT.md) at the root, no `docs/adr/` yet. `docs/agents/domain.md`
is a pointer to it, not a second copy of it.
See [`docs/agents/domain.md`](./docs/agents/domain.md).
