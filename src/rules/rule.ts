import type { Diagnostic } from "../diagnostic.js";
import type { ManifestPackage } from "../manifest.js";

/**
 * Everything a rule needs from the outside world, injected at the impure
 * boundary (`lintDirectory`) so that rules themselves stay pure. Today this is
 * only the current time: rules must never read the clock (`Date.now()`,
 * `new Date()`), because a non-deterministic rule cannot be validated against
 * the pinned winget-pkgs corpus. A rule that needs "now" — e.g. to judge
 * whether a `ReleaseDate` is in the future — receives it here instead.
 */
export interface RuleContext {
  /** The current time, read once at the boundary and shared by every rule. */
  now: Date;
}

/**
 * A rule inspects a parsed package and returns diagnostics. It must be pure:
 * no I/O, no network, no clock reads beyond what is passed in via `context`.
 * That is what makes the winget-pkgs corpus run (see docs) fast enough — and
 * deterministic enough — to be a CI gate.
 *
 * `context` is optional so that clock-independent rules (the majority) can be
 * written and unit-tested as `check(pkg)`. `lintDirectory` always supplies it.
 */
export interface Rule {
  /** Stable kebab-case id. Appears in output and must never be renamed. */
  id: string;
  /** One line, present tense, describing what a *passing* manifest looks like. */
  description: string;
  check(pkg: ManifestPackage, context?: RuleContext): Diagnostic[];
}

/** Identity helper — exists purely so rule objects get checked at definition. */
export function defineRule(rule: Rule): Rule {
  return rule;
}
