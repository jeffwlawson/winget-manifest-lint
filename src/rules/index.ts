import type { Rule } from "./rule.js";
import packageIdentifierFormat from "./package-identifier-format.js";

/**
 * The rule registry.
 *
 * To add a rule: create `src/rules/<rule-id>.ts` exporting a `defineRule({...})`
 * as its default export, import it here, and append it to this array. Nothing
 * else needs to change — the CLI and the corpus job both read this list.
 *
 * Keep the array ordered by rule id so diffs stay readable.
 */
export const rules: Rule[] = [packageIdentifierFormat];

export { defineRule } from "./rule.js";
export type { Rule } from "./rule.js";
