# Context

The domain model. Read this before adding a rule — it is the difference between a rule that
fits and a rule that invents a parallel architecture.

## What a manifest is

A winget *package version* is **three YAML files in one directory**, not one file:

```
manifests/s/sharkdp/bat/0.26.1/
  sharkdp.bat.yaml                 version manifest — the index
  sharkdp.bat.installer.yaml       installers, hashes, architectures
  sharkdp.bat.locale.en-US.yaml    name, description, URLs, licence
```

A package may have **many** locale files (`.locale.fr-FR.yaml`, …) but exactly one of them is
the *default* locale. There is always exactly one version file and one installer file.

The directory name **is** the version string, and must equal the `PackageVersion` field inside
the files. Nothing enforces this at authoring time, which is why it is a rule.

## Role vs. ManifestType — do not conflate these

A file's **role** is derived from its *file name* and nothing else:

| File name | Role |
|---|---|
| `<id>.yaml` | `version` |
| `<id>.installer.yaml` | `installer` |
| `<id>.locale.<tag>.yaml` | `locale` |

Separately, every file contains a `ManifestType` field claiming what it is. The two can
disagree — that is a bug in the manifest, and a rule exists purely to catch it. So the parser
derives role from the name, records `ManifestType` as ordinary data, and never uses one to
infer the other.

Note `defaultLocale` is **not** a role. A default-locale manifest is a `locale`-role file whose
`ManifestType` happens to be `defaultLocale`.

## The three rule classes

Rules get harder in three steps, and the class tells you what to reach for:

1. **Single-field** — one value, judged alone. `InstallerSha256` is 64 hex characters;
   `Architecture` is in the allowed enum; `ShortDescription` is ≤256 chars; URLs are https.
   These need one file and one path.

2. **Cross-field, within a file** — a value is only valid given another value in the same
   file. `InstallerType: zip` *requires* `NestedInstallerType` **and** a `NestedInstallerFiles`
   entry with a `RelativeFilePath`. No two installers may share an
   `(Architecture, InstallerType, Scope)` tuple.

3. **Cross-file** — the three files must agree. `PackageIdentifier`, `PackageVersion` and
   `ManifestVersion` must be identical in all of them, and `PackageVersion` must match the
   directory name. This is a real failure mode, not a theoretical one: Komac generates the
   three files independently.

## Diagnostics

`Diagnostic` (see `src/diagnostic.ts`) is the **only** thing a rule produces. Rules never
print, never throw, never exit. A diagnostic carries a stable `ruleId`, a severity, a message,
the file it concerns, and — when it is about a specific value rather than a whole file — a
1-based `Position`.

Positions come from `positionOf(file, path)`, which resolves a path like
`["Installers", 1, "InstallerSha256"]` against the YAML CST. A rule that reports a *missing*
key legitimately has no position; that is why `position` is optional.

## Rules are pure

No I/O, no network, no clock. A rule receives a parsed `ManifestPackage` and returns an array.

This is not stylistic. The linter is validated against a pinned snapshot of
`microsoft/winget-pkgs` — tens of thousands of manifests that are all known-good, because
Microsoft accepted them. **Any diagnostic we emit against that corpus is by definition a false
positive in one of our rules.** That gives us a free pre-labelled regression suite, but only if
rules are fast and deterministic enough to run across all of it in CI.

## Non-goals

- Not a generator. Komac does that.
- Not a network client. It never fetches `InstallerUrl` to verify a hash.
- Not a substitute for install-testing. A valid manifest can still install something broken.
