# winget-manifest-lint

A linter for [winget](https://github.com/microsoft/winget-pkgs) package manifests.

A winget package version is three YAML files that must agree with each other. This validates
them — offline, with no network access — and reports precise, positioned diagnostics.

```bash
winget-manifest-lint manifests/s/sharkdp/bat/0.26.1/
```

## Status

Early. See [CONTEXT.md](./CONTEXT.md) for the domain model and
[docs/friction.md](./docs/friction.md) for the build log.

## Non-goals

- **Not a generator.** [Komac](https://github.com/russellbanks/Komac) already does that.
- **Not a network client.** It will not fetch `InstallerUrl` to verify hashes.
- **Not a replacement for install-testing.** A manifest can be perfectly valid and still
  install something broken.

## Licence

MIT
