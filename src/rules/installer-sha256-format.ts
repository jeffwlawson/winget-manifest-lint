import type { Diagnostic } from "../diagnostic.js";
import { installerFile, positionOf } from "../manifest.js";
import { defineRule } from "./rule.js";

/**
 * Every installer is addressed by the SHA-256 of its download: winget refuses to
 * install a file whose hash does not match. The field is therefore mandatory on
 * each installer entry and must be exactly 64 hexadecimal characters — the
 * lowercase or uppercase rendering of a 32-byte digest. An absent, truncated, or
 * non-hex value is a broken manifest.
 *
 * This is a single-field rule (see CONTEXT.md): each `InstallerSha256` is judged
 * alone, against one file and one path. `InstallerSha256` is per-installer — it
 * has no root-level default — so we walk `Installers` and check each entry,
 * pointing the diagnostic at `Installers[i].InstallerSha256` (or the entry
 * itself when the key is missing entirely).
 */
const SHA256 = /^[0-9a-fA-F]{64}$/;

export default defineRule({
  id: "installer-sha256-format",
  description: "Every installer's InstallerSha256 is exactly 64 hexadecimal characters.",
  check(pkg) {
    const file = installerFile(pkg);
    if (!file) return [];

    const installers = file.data["Installers"];
    if (!Array.isArray(installers)) return [];

    const diagnostics: Diagnostic[] = [];

    installers.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return;
      const value = (entry as Record<string, unknown>)["InstallerSha256"];

      if (typeof value === "string" && SHA256.test(value)) return;

      const position =
        positionOf(file, ["Installers", index, "InstallerSha256"]) ??
        positionOf(file, ["Installers", index]);
      const base = {
        ruleId: "installer-sha256-format",
        severity: "error" as const,
        file: file.fileName,
        ...(position === undefined ? {} : { position }),
      };

      if (value === undefined) {
        diagnostics.push({
          ...base,
          message: `Installer entry ${index} is missing InstallerSha256, which must be 64 hexadecimal characters.`,
        });
      } else if (typeof value !== "string") {
        diagnostics.push({
          ...base,
          message: `Installers[${index}].InstallerSha256 must be a 64-character hexadecimal string.`,
        });
      } else {
        const detail =
          value.length === 64
            ? "it contains non-hexadecimal characters"
            : `it is ${value.length} characters`;
        diagnostics.push({
          ...base,
          message: `Installers[${index}].InstallerSha256 "${value}" must be 64 hexadecimal characters, but ${detail}.`,
        });
      }
    });

    return diagnostics;
  },
});
