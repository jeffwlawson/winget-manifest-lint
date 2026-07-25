import type { Diagnostic } from "../diagnostic.js";
import { installerFile, positionOf, type ManifestFile } from "../manifest.js";
import { defineRule } from "./rule.js";

/**
 * `ReleaseDate` is a winget installer-manifest field (`YYYY-MM-DD`, ISO 8601
 * full-date). It may be declared once at the root of the installer file and/or
 * overridden per installer, so this rule judges every copy it finds.
 *
 * A single-field rule (see CONTEXT.md): each `ReleaseDate` value is judged
 * alone. It is a *warning*, not an error — a wrong date does not break an
 * install, it just signals a likely typo or copy-paste mistake. We warn when
 * the value is:
 *
 * - not a valid ISO 8601 date (`2024-1-5`, `2024-13-40`, `not-a-date`); or
 * - in the future relative to the injected clock.
 *
 * There is deliberately **no lower bound.** The original spec warned on dates
 * before 2015-01-01 as "implausibly old", justified by winget not existing yet.
 * Both halves of that were wrong: winget launched in 2020, and `ReleaseDate` is
 * the *software's* release date, which legitimately predates any package
 * manager. The corpus proved it — `Microsoft.XNARedist` (2011-09-01) and three
 * other Microsoft-accepted manifests tripped the bound. Any cutoff is
 * arbitrary, so we flag only what is unambiguously wrong: a date that has not
 * happened yet.
 *
 * `now` is the only clock-adjacent input and it is pure: injected via the rule
 * context, never read from the clock (a non-deterministic rule cannot be
 * validated against the corpus). Without a context there is no clock, so the
 * rule stays silent rather than inventing one.
 */

// Strict ISO 8601 full-date: four-digit year, zero-padded month and day.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type Verdict = "invalid" | "future" | "ok";

/** Parse and classify a candidate value against `now`. Pure. */
function classify(value: string, now: Date): Verdict {
  const match = ISO_DATE.exec(value);
  if (!match) return "invalid";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);

  // Reject dates that pass the pattern but do not exist (e.g. 2024-02-30):
  // Date.UTC rolls those over, so the round-trip no longer matches.
  const rolled = new Date(utc);
  if (
    rolled.getUTCFullYear() !== year ||
    rolled.getUTCMonth() !== month - 1 ||
    rolled.getUTCDate() !== day
  ) {
    return "invalid";
  }

  if (utc > now.getTime()) return "future";
  return "ok";
}

function messageFor(verdict: Exclude<Verdict, "ok">, value: string): string {
  switch (verdict) {
    case "invalid":
      return `ReleaseDate "${value}" is not a valid ISO 8601 date (YYYY-MM-DD).`;
    case "future":
      return `ReleaseDate "${value}" is in the future.`;
  }
}

/** Every place a `ReleaseDate` may appear in the installer file, with its path. */
function releaseDatePaths(file: ManifestFile): Array<(string | number)[]> {
  const paths: Array<(string | number)[]> = [];
  if ("ReleaseDate" in file.data) paths.push(["ReleaseDate"]);

  const installers = file.data["Installers"];
  if (Array.isArray(installers)) {
    installers.forEach((entry, index) => {
      if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
        if ("ReleaseDate" in (entry as Record<string, unknown>)) {
          paths.push(["Installers", index, "ReleaseDate"]);
        }
      }
    });
  }
  return paths;
}

export default defineRule({
  id: "release-date-plausible",
  description: "ReleaseDate is a valid ISO 8601 date that is not in the future.",
  check(pkg, context) {
    const now = context?.now;
    if (!now) return [];

    const file = installerFile(pkg);
    if (!file) return [];

    const diagnostics: Diagnostic[] = [];

    for (const path of releaseDatePaths(file)) {
      const value = file.doc.getIn([...path]);
      if (typeof value !== "string") continue;

      const verdict = classify(value, now);
      if (verdict === "ok") continue;

      const position = positionOf(file, path);
      diagnostics.push({
        ruleId: "release-date-plausible",
        severity: "warning",
        message: messageFor(verdict, value),
        file: file.fileName,
        ...(position === undefined ? {} : { position }),
      });
    }

    return diagnostics;
  },
});
