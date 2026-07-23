import type { Diagnostic } from "../diagnostic.js";
import { positionOf, versionFile } from "../manifest.js";
import { defineRule } from "./rule.js";

/**
 * `PackageIdentifier` is a dotted identifier — `Publisher.Package`, optionally
 * with further qualifying segments (`Microsoft.VisualStudio.2022.Community`).
 * winget's schema allows a first segment followed by 1 to 7 more, i.e. between
 * 2 and 8 segments in total, with a total length of at most 128 characters.
 * Capping segments at 4 flagged legitimate identifiers in the winget-pkgs
 * corpus (e.g. `Microsoft.VisualStudioCode.Insiders.System.arm64`) as false
 * positives.
 *
 * This is a single-field rule (see CONTEXT.md): it judges one value in one
 * file. The identifier appears in all three files, but the version manifest is
 * the index, so we validate its copy here; a separate cross-file rule checks
 * that the other files agree, which together covers a malformed identifier
 * wherever it appears without reporting the same problem three times.
 */
const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 8;
const MAX_LENGTH = 128;
// Each segment matches `[^.\s...]{1,32}` in the schema: 1 to 32 characters, so
// an empty segment (a leading, trailing, or doubled dot) is a length violation
// too — this check subsumes the empty-segment case.
const MIN_SEGMENT_LENGTH = 1;
const MAX_SEGMENT_LENGTH = 32;

export default defineRule({
  id: "package-identifier-format",
  description:
    "PackageIdentifier is 2 to 8 dot-separated segments and at most 128 characters.",
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

    const segments = value.split(".");
    if (segments.length < MIN_SEGMENTS || segments.length > MAX_SEGMENTS) {
      diagnostics.push({
        ...base,
        message: `PackageIdentifier "${value}" must have ${MIN_SEGMENTS} to ${MAX_SEGMENTS} dot-separated segments, but has ${segments.length}.`,
      });
    }

    const badSegment = segments.find(
      (segment) =>
        segment.length < MIN_SEGMENT_LENGTH || segment.length > MAX_SEGMENT_LENGTH,
    );
    if (badSegment !== undefined) {
      const detail =
        badSegment.length === 0
          ? "an empty segment (leading, trailing, or doubled dot)"
          : `segment "${badSegment}" is ${badSegment.length} characters`;
      diagnostics.push({
        ...base,
        message: `PackageIdentifier "${value}" has ${detail}; each segment must be ${MIN_SEGMENT_LENGTH} to ${MAX_SEGMENT_LENGTH} characters.`,
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
