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

Early. See [CONTEXT.md](./CONTEXT.md) for the domain model,
[docs/friction.md](./docs/friction.md) for the build log, and
[docs/parity.md](./docs/parity.md) for how this repo's agent loop compares to the one it was
modelled on.

## Non-goals

- **Not a generator.** [Komac](https://github.com/russellbanks/Komac) already does that.
- **Not a network client.** It will not fetch `InstallerUrl` to verify hashes.
- **Not a replacement for install-testing.** A manifest can be perfectly valid and still
  install something broken.

## Licence

MIT
