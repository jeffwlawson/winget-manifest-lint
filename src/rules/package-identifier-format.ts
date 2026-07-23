import type { Diagnostic } from "../diagnostic.js";
import { positionOf, versionFile } from "../manifest.js";
import { defineRule } from "./rule.js";

/**
 * `PackageIdentifier` is a dotted identifier — `Publisher.Package`, optionally
 * with further qualifying segments (`Microsoft.VisualStudio.2022.Community`).
 * winget requires between 2 and 4 segments and a total length of at most 128
 * characters.
 *
 * This is a single-field rule (see CONTEXT.md): it judges one value in one
 * file. The identifier appears in all three files, but the version manifest is
 * the index, so we validate its copy here; a separate cross-file rule checks
 * that the other files agree, which together covers a malformed identifier
 * wherever it appears without reporting the same problem three times.
 */
const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 4;
const MAX_LENGTH = 128;

export default defineRule({
  id: "package-identifier-format",
  description:
    "PackageIdentifier is 2 to 4 dot-separated segments and at most 128 characters.",
  check(pkg) {
    const file = versionFile(pkg);
    if (!file) return [];

    const value = file.data["PackageIdentifier"];
    if (typeof value !== "string") return [];

    const position = positionOf(file, ["PackageIdentifier"]);
    const base = {
      ruleId: "package-identifier-format",
      severity: "error" as const,
      file: file.fileName,
      ...(position === undefined ? {} : { position }),
    };

    const diagnostics: Diagnostic[] = [];

    const segments = value.split(".").length;
    if (segments < MIN_SEGMENTS || segments > MAX_SEGMENTS) {
      diagnostics.push({
        ...base,
        message: `PackageIdentifier "${value}" must have ${MIN_SEGMENTS} to ${MAX_SEGMENTS} dot-separated segments, but has ${segments}.`,
      });
    }

    if (value.length > MAX_LENGTH) {
      diagnostics.push({
        ...base,
        message: `PackageIdentifier "${value}" exceeds the ${MAX_LENGTH}-character limit (${value.length} characters).`,
      });
    }

    return diagnostics;
  },
});
