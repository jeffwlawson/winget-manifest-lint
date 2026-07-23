import type { Diagnostic } from "../diagnostic.js";
import { installerFile, positionOf } from "../manifest.js";
import { defineRule } from "./rule.js";

/**
 * winget picks one installer for a given install by matching on the
 * `(InstallerType, Architecture, InstallerLocale, Scope)` combination — the
 * exact key winget-cli uses to reject duplicate installer entries
 * (`ManifestValidation.cpp`: "{installerType, arch, language and scope}
 * combination is the key"). Two entries that resolve to the same key are
 * ambiguous — winget cannot tell them apart — so the manifest is rejected.
 * This is a cross-field, within-a-file rule (see CONTEXT.md): each entry is
 * judged against the others in the same installer file.
 *
 * Three subtleties, all mirrored from winget:
 *
 * - `InstallerType`, `Scope` and `InstallerLocale` may be declared once at the
 *   root as defaults and overridden per installer, so we resolve each entry's
 *   effective value before comparing. `Architecture` is always per-installer.
 * - For **archive** installer types (e.g. `zip`), the `NestedInstallerType`
 *   joins the key: two archives differing only by what they unpack to are
 *   distinct installers.
 * - **Scope is a wildcard when unspecified.** It only differentiates two
 *   installers when *both* declare a known scope and those scopes differ. An
 *   absent scope matches any scope — so an entry with no scope collides with
 *   one that says `machine`, not just with another that also omits it.
 */
const ARCHIVE_TYPES = new Set(["zip"]);

interface InstallerKey {
  architecture: string | undefined;
  type: string | undefined;
  locale: string | undefined;
  /** Only part of the key for archive types; undefined otherwise. */
  nestedType: string | undefined;
  scope: string | undefined;
}

export default defineRule({
  id: "installer-entry-unique",
  description:
    "No two installers share the same (InstallerType, Architecture, InstallerLocale, Scope) combination.",
  check(pkg) {
    const file = installerFile(pkg);
    if (!file) return [];

    const installers = file.data["Installers"];
    if (!Array.isArray(installers)) return [];

    const rootType = stringOrUndefined(file.data["InstallerType"]);
    const rootScope = stringOrUndefined(file.data["Scope"]);
    const rootLocale = stringOrUndefined(file.data["InstallerLocale"]);
    const rootNestedType = stringOrUndefined(file.data["NestedInstallerType"]);

    const diagnostics: Diagnostic[] = [];
    const kept: InstallerKey[] = [];

    installers.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return;
      const record = entry as Record<string, unknown>;

      const type = stringOrUndefined(record["InstallerType"]) ?? rootType;
      const key: InstallerKey = {
        architecture: stringOrUndefined(record["Architecture"]),
        type,
        locale: stringOrUndefined(record["InstallerLocale"]) ?? rootLocale,
        nestedType: isArchive(type)
          ? (stringOrUndefined(record["NestedInstallerType"]) ?? rootNestedType)
          : undefined,
        scope: stringOrUndefined(record["Scope"]) ?? rootScope,
      };

      if (!kept.some((prior) => collides(prior, key))) {
        kept.push(key);
        return;
      }

      const position = positionOf(file, ["Installers", index]);
      diagnostics.push({
        ruleId: "installer-entry-unique",
        severity: "error",
        file: file.fileName,
        message: `Installer entry ${index} repeats the ${describe(key)} of an earlier installer. Each installer must be uniquely addressable.`,
        ...(position === undefined ? {} : { position }),
      });
    });

    return diagnostics;
  },
});

/**
 * Two installers collide when every literal field matches and their scopes are
 * compatible. Scope compatibility is asymmetric-looking but total: an absent
 * scope is a wildcard, so scopes conflict only when both are present and differ.
 */
function collides(a: InstallerKey, b: InstallerKey): boolean {
  if (a.architecture !== b.architecture) return false;
  if (a.type !== b.type) return false;
  if (a.locale !== b.locale) return false;
  if (a.nestedType !== b.nestedType) return false;
  if (a.scope !== undefined && b.scope !== undefined && a.scope !== b.scope) return false;
  return true;
}

function isArchive(type: string | undefined): boolean {
  return type !== undefined && ARCHIVE_TYPES.has(type.toLowerCase());
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Human-readable rendering of the key that made an entry a duplicate. */
function describe(key: InstallerKey): string {
  const fields = [
    `Architecture: ${label(key.architecture)}`,
    `InstallerType: ${label(key.type)}`,
    `InstallerLocale: ${label(key.locale)}`,
    ...(key.nestedType === undefined ? [] : [`NestedInstallerType: ${key.nestedType}`]),
    `Scope: ${label(key.scope)}`,
  ];
  return `(${fields.join(", ")}) combination`;
}

/** Render a field, distinguishing an absent value from a real one. */
function label(value: string | undefined): string {
  return value === undefined ? "(none)" : value;
}
