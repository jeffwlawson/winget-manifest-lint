import { compareDiagnostics, type Diagnostic } from "./diagnostic.js";
import { parseManifestDirectory } from "./manifest.js";
import { rules } from "./rules/index.js";
import type { RuleContext } from "./rules/rule.js";

export interface LintOptions {
  /** Restrict to a subset of rule ids. Defaults to every registered rule. */
  ruleIds?: string[];
  /**
   * The "current time" clock-dependent rules judge against (e.g. is a
   * `ReleaseDate` in the future?). Injected here — the one impure boundary —
   * so the rules stay pure and deterministic. Defaults to the real clock;
   * tests pass a fixed value.
   */
  now?: Date;
}

/**
 * Lint one version directory. Returns diagnostics sorted into a stable order —
 * output must be deterministic so it can be snapshotted and diffed across a
 * corpus run.
 */
export async function lintDirectory(
  directory: string,
  options: LintOptions = {},
): Promise<Diagnostic[]> {
  const { pkg, diagnostics } = await parseManifestDirectory(directory);
  const selected = options.ruleIds
    ? rules.filter((r) => options.ruleIds?.includes(r.id))
    : rules;

  const context: RuleContext = { now: options.now ?? new Date() };
  const all = [...diagnostics];
  for (const rule of selected) {
    all.push(...rule.check(pkg, context));
  }
  return all.sort(compareDiagnostics);
}
