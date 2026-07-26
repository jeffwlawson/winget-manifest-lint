import type { Diagnostic } from "../diagnostic.js";
import { installerFile, positionOf } from "../manifest.js";
import { defineRule } from "./rule.js";

/**
 * The installer file exists to list installers, so an installer file that
 * declares none is useless: winget has nothing to download and run. The schema
 * requires `Installers` to be a non-empty array, and winget-cli rejects a
 * manifest without at least one installer entry.
 *
 * This is a single-field rule (see CONTEXT.md): it judges one value — the
 * `Installers` array — in one file. It fires when that value is missing, is not
 * an array, or is an empty array. A missing key has no position (there is
 * nothing to point at); a present-but-wrong value points at the key.
 *
 * When the package has no installer file at all, this rule stays silent: the
 * absence of a required file is a different failure mode, left to a rule that
 * reasons about which files a package must have.
 */
export default defineRule({
  id: "installers-non-empty",
  description: "The installer file declares at least one installer entry.",
  check(pkg) {
    const file = installerFile(pkg);
    if (!file) return [];

    const installers = file.data["Installers"];
    if (Array.isArray(installers) && installers.length > 0) return [];

    const reason =
      installers === undefined
        ? "is missing"
        : Array.isArray(installers)
          ? "is empty"
          : "is not a list";

    const position = positionOf(file, ["Installers"]);
    const diagnostic: Diagnostic = {
      ruleId: "installers-non-empty",
      severity: "error",
      file: file.fileName,
      message: `Installers ${reason}; a manifest must declare at least one installer entry.`,
      ...(position === undefined ? {} : { position }),
    };
    return [diagnostic];
  },
});
