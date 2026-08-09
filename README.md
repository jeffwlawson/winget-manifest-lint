# winget-manifest-lint

A linter for [winget](https://github.com/microsoft/winget-pkgs) package manifests.

A winget package version is three YAML files that must agree with each other. This validates
them — offline, with no network access — and reports precise, positioned diagnostics.

```bash
winget-manifest-lint manifests/s/sharkdp/bat/0.26.1/
```

## Usage

```
winget-manifest-lint [--format text|github] [--strict] <dir>...
```

Accepts one or more manifest version directories.

| Option | Effect |
|---|---|
| `--format text` | Human-readable report (the default). |
| `--format github` | GitHub Actions annotation commands, for inline PR annotations. |
| `--strict` | Promote warnings to errors. |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No errors. Warnings alone (without `--strict`) still exit `0`. |
| `1` | Errors found. With `--strict`, warnings are promoted and count here too. |
| `2` | Bad usage, or an input directory could not be read. |

## Status

Early. See [CONTEXT.md](./CONTEXT.md) for the domain model.

The linter is a testbed. The thing actually being built is the **agent loop around it** — five
workflows that turn a labelled issue into a reviewed pull request unattended. That loop is not
hosted here: it lives in
[jeffwlawson/agent-workflows](https://github.com/jeffwlawson/agent-workflows), and this repo
consumes it through five caller workflows (`.github/workflows/agent-*.yml`) pinned to a
published version. This repo is the loop's first adopter, so it exercises the same path any
other adopter takes.

The loop's own docs live in that repository, not this one:

| Document | What it is |
|---|---|
| [`agent-workflows` docs/ADOPTING.md](https://github.com/jeffwlawson/agent-workflows/blob/main/docs/ADOPTING.md) | How to install the loop somewhere else. |
| [`agent-workflows` docs/friction.md](https://github.com/jeffwlawson/agent-workflows/blob/main/docs/friction.md) | The build log. |
| [`agent-workflows` docs/parity.md](https://github.com/jeffwlawson/agent-workflows/blob/main/docs/parity.md) | How the loop compares to the one it was modelled on. |

## Non-goals

- **Not a generator.** [Komac](https://github.com/russellbanks/Komac) already does that.
- **Not a network client.** It will not fetch `InstallerUrl` to verify hashes.
- **Not a replacement for install-testing.** A manifest can be perfectly valid and still
  install something broken.

## Licence

MIT
