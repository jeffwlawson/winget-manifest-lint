import type { Rule } from "./rule.js";
import architectureEnum from "./architecture-enum.js";
import installerEntryUnique from "./installer-entry-unique.js";
import installerSha256Format from "./installer-sha256-format.js";
import installersNonEmpty from "./installers-non-empty.js";
import nestedInstallerCompatibility from "./nested-installer-compatibility.js";
import packageIdentifierFormat from "./package-identifier-format.js";
import packageVersionMatchesDirectory from "./package-version-matches-directory.js";
import packageVersionPathSafe from "./package-version-path-safe.js";
import releaseDatePlausible from "./release-date-plausible.js";

/**
 * The rule registry.
 *
 * To add a rule: create `src/rules/<rule-id>.ts` exporting a `defineRule({...})`
 * as its default export, import it here, and append it to this array. Nothing
 * else needs to change — the CLI and the corpus job both read this list.
 *
 * Keep the array ordered by rule id so diffs stay readable.
 */
export const rules: Rule[] = [
  architectureEnum,
  installerEntryUnique,
  installerSha256Format,
  installersNonEmpty,
  nestedInstallerCompatibility,
  packageIdentifierFormat,
  packageVersionMatchesDirectory,
  packageVersionPathSafe,
  releaseDatePlausible,
];

export { defineRule } from "./rule.js";
export type { Rule, RuleContext } from "./rule.js";
