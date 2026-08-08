# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the
codebase.

This repo is **single-context**: one `CONTEXT.md` at the root, no `CONTEXT-MAP.md`.

## Before exploring, read these

- **[`CONTEXT.md`](../../CONTEXT.md)** at the repo root — the domain model. Read the *role vs.
  `ManifestType`* section and the three rule classes before proposing or writing a rule; almost
  every mistake this project has seen is one of those two distinctions collapsing.
- **[`CLAUDE.md`](../../CLAUDE.md)** at the repo root — commands and conventions, including the
  single gate (`npm run verify`).
- **`docs/adr/`** — does not exist yet. If it appears, read the ADRs that touch the area you are
  about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest
creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and
`/improve-codebase-architecture`) creates them lazily when terms or decisions actually get
resolved.

## `CONTEXT.md` is the domain model — this file is only a pointer

**Do not restate the domain here.** `CONTEXT.md` is load-bearing (see `docs/ADOPTING.md` §6: an
agent reasoned its way to a correct cross-file boundary from that file alone), and a second,
thinner copy of the domain model would drift from it and quietly start winning arguments. When
the domain changes, `CONTEXT.md` changes; this file only says where to look.

The same rule applies in reverse: nothing in this file is a substitute for reading `CONTEXT.md`.

## File structure

```
/
├── CONTEXT.md          ← the domain model
├── CLAUDE.md           ← commands and conventions
├── docs/
│   ├── agents/         ← this directory: per-repo config for the engineering skills
│   ├── ADOPTING.md     ← installing the agent loop elsewhere
│   ├── friction.md     ← every time a human reached into the loop
│   └── parity.md       ← feature-by-feature gap analysis vs. the upstream loop
└── src/
```

`docs/adr/` is the conventional home for ADRs if this repo ever grows them. Today the decisions
that would live there are recorded in `docs/friction.md` (what broke and what was done) and
`docs/parity.md` §10 (invariants that must hold as features are added) — read those when you need
the *why* behind a piece of the agent loop rather than the *why* behind the linter's domain.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a
test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary
explicitly avoids — `role` and `ManifestType` in particular are not interchangeable, and treating
them as such is the specific error `CONTEXT.md` exists to prevent.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing
language the project doesn't use (reconsider) or there's a real gap (note it for
`/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR — or, here, an invariant in `docs/parity.md` §10 —
surface it explicitly rather than silently overriding:

> _Contradicts the "review stays `contents: read`" invariant — but worth reopening because…_
