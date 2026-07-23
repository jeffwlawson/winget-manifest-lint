import type { Diagnostic } from "../diagnostic.js";
import { positionOf, versionFile } from "../manifest.js";
import { defineRule } from "./rule.js";

/**
 * `PackageVersion` becomes the name of the directory the manifest lives in
 * (`manifests/s/sharkdp/bat/0.26.1/`), so it must not contain characters that
 * are illegal or dangerous in a path. winget's schema forbids the Windows
 * reserved filename characters `\ / : * ? " < > |` and all control characters
 * (code points U+0001 to U+001F); this rule reports any of them.
 *
 * This is a single-field rule (see CONTEXT.md): it judges one value in one
 * file. `PackageVersion` appears in all three files, but the version manifest
 * is the index, so we validate its copy here; a separate cross-file rule checks
 * that the other files agree.
 */
const RESERVED = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|"]);
const CONTROL_MAX = 0x1f;

function isPathUnsafe(char: string): boolean {
  if (RESERVED.has(char)) return true;
  const code = char.codePointAt(0) ?? 0;
  return code <= CONTROL_MAX;
}

function describe(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  if (code <= CONTROL_MAX) return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  return `"${char}"`;
}

export default defineRule({
  id: "package-version-path-safe",
  description:
    'PackageVersion contains no path-unsafe characters (\\ / : * ? " < > | or control characters).',
  check(pkg) {
    const file = versionFile(pkg);
    if (!file) return [];

    const value = file.data["PackageVersion"];
    if (typeof value !== "string") return [];

    const offending = [...new Set([...value].filter(isPathUnsafe))];
    if (offending.length === 0) return [];

    const position = positionOf(file, ["PackageVersion"]);
    const diagnostic: Diagnostic = {
      ruleId: "package-version-path-safe",
      severity: "error",
      file: file.fileName,
      message: `PackageVersion "${value}" contains path-unsafe character${
        offending.length === 1 ? "" : "s"
      } ${offending.map(describe).join(", ")}.`,
      ...(position === undefined ? {} : { position }),
    };

    return [diagnostic];
  },
});
