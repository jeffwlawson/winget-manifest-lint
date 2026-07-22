import type { Diagnostic } from "../diagnostic.js";
import type { ManifestPackage } from "../manifest.js";

/**
 * A rule inspects a parsed package and returns diagnostics. It must be pure:
 * no I/O, no network, no clock reads beyond what is passed in. That is what
 * makes the winget-pkgs corpus run (see docs) fast enough to be a CI gate.
 */
export interface Rule {
  /** Stable kebab-case id. Appears in output and must never be renamed. */
  id: string;
  /** One line, present tense, describing what a *passing* manifest looks like. */
  description: string;
  check(pkg: ManifestPackage): Diagnostic[];
}

/** Identity helper — exists purely so rule objects get checked at definition. */
export function defineRule(rule: Rule): Rule {
  return rule;
}
