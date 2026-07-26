import type { Diagnostic } from "../diagnostic.js";
import {
  ARCHITECTURES,
  installerFile,
  isKnownArchitecture,
  positionOf,
  stringOrUndefined,
} from "../manifest.js";
import { defineRule } from "./rule.js";

/**
 * Every installer declares an `Architecture`, and winget accepts only a fixed
 * set: x86, x64, arm, arm64, neutral. winget-cli parses the field into an enum
 * and the manifest schema pins the enum to those exact lower-case spellings, so
 * a value outside the set — including a case variant like `X64` — is rejected.
 *
 * This is a single-field rule (see CONTEXT.md): each `Architecture` is judged
 * alone against the allowed set. `Architecture` is always per-installer (never a
 * root default), so we check each entry's own value; the allowed set is the one
 * exported `ARCHITECTURES` constant, shared with `installer-entry-unique`.
 *
 * A missing or non-string `Architecture` is out of scope here — that is a
 * required-field concern — so we say nothing and let another rule own it.
 */
export default defineRule({
  id: "architecture-enum",
  description: `Every installer's Architecture is one of ${ARCHITECTURES.join(", ")}.`,
  check(pkg) {
    const file = installerFile(pkg);
    if (!file) return [];

    const installers = file.data["Installers"];
    if (!Array.isArray(installers)) return [];

    const diagnostics: Diagnostic[] = [];

    installers.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return;
      const architecture = stringOrUndefined((entry as Record<string, unknown>)["Architecture"]);
      if (architecture === undefined || isKnownArchitecture(architecture)) return;

      const position = positionOf(file, ["Installers", index, "Architecture"]);
      diagnostics.push({
        ruleId: "architecture-enum",
        severity: "error",
        file: file.fileName,
        message: `Installer entry ${index} has Architecture "${architecture}", which is not one of ${ARCHITECTURES.join(", ")}.`,
        ...(position === undefined ? {} : { position }),
      });
    });

    return diagnostics;
  },
});
