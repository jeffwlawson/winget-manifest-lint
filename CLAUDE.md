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
