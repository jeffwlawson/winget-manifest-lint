import type { Diagnostic } from "../diagnostic.js";
import { installerFile, positionOf } from "../manifest.js";
import { defineRule } from "./rule.js";

/**
 * winget picks one installer for a given install by matching on the
 * `(Architecture, InstallerType, Scope)` triple. Two installer entries that
 * resolve to the same triple are therefore ambiguous — winget cannot tell them
 * apart — and the schema rejects the manifest. This is a cross-field,
 * within-a-file rule (see CONTEXT.md): each entry is judged against the others
 * in the same installer file.
 *
 * `InstallerType` and `Scope` may be declared once at the root as defaults and
 * overridden per installer, so we resolve each entry's effective value before
 * comparing. `Architecture` is always per-installer. `Scope` is optional; two
 * entries that both omit it collide just as surely as two that both say
 * `machine`, so an absent scope is a value in its own right.
 */
export default defineRule({
  id: "installer-architecture-type-scope-unique",
  description:
    "No two installers share the same (Architecture, InstallerType, Scope) combination.",
  check(pkg) {
    const file = installerFile(pkg);
    if (!file) return [];

    const installers = file.data["Installers"];
    if (!Array.isArray(installers)) return [];

    const rootType = stringOrUndefined(file.data["InstallerType"]);
    const rootScope = stringOrUndefined(file.data["Scope"]);

    const diagnostics: Diagnostic[] = [];
    const seen = new Set<string>();

    installers.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return;
      const record = entry as Record<string, unknown>;

      const architecture = stringOrUndefined(record["Architecture"]);
      const type = stringOrUndefined(record["InstallerType"]) ?? rootType;
      const scope = stringOrUndefined(record["Scope"]) ?? rootScope;

      const key = JSON.stringify([architecture, type, scope]);
      if (!seen.has(key)) {
        seen.add(key);
        return;
      }

      const tuple = `(${label(architecture)}, ${label(type)}, ${label(scope)})`;
      const position = positionOf(file, ["Installers", index]);
      diagnostics.push({
        ruleId: "installer-architecture-type-scope-unique",
        severity: "error",
        file: file.fileName,
        message: `Installer entry ${index} repeats the (Architecture, InstallerType, Scope) combination ${tuple}. Each installer must be uniquely addressable.`,
        ...(position === undefined ? {} : { position }),
      });
    });

    return diagnostics;
  },
});

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Render a tuple component, distinguishing an absent value from a real one. */
function label(value: string | undefined): string {
  return value === undefined ? "(none)" : value;
}
