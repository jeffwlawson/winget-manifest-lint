import { compareDiagnostics, type Diagnostic } from "./diagnostic.js";
import { parseManifestDirectory } from "./manifest.js";
import { rules } from "./rules/index.js";

export interface LintOptions {
  /** Restrict to a subset of rule ids. Defaults to every registered rule. */
  ruleIds?: string[];
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

  const all = [...diagnostics];
  for (const rule of selected) {
    all.push(...rule.check(pkg));
  }
  return all.sort(compareDiagnostics);
}
