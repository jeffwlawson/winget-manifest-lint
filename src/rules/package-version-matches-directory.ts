import type { Diagnostic } from "../diagnostic.js";
import { positionOf, versionFile } from "../manifest.js";
import { defineRule } from "./rule.js";

/**
 * The directory a manifest lives in *is* its version:
 * `manifests/s/sharkdp/bat/0.26.1/` holds version `0.26.1`. winget derives the
 * version from that path, so a `PackageVersion` field that disagrees with the
 * directory name ships a package under the wrong version — a real failure mode,
 * because Komac generates the three files independently of the path.
 *
 * This is a cross-file rule (see CONTEXT.md), but it only needs the version
 * manifest: that file is the index, so we compare its `PackageVersion` against
 * the directory name here. A separate cross-file rule checks that the installer
 * and locale files carry the same `PackageVersion`, which together anchors all
 * three to the directory without reporting the same mismatch three times.
 */
export default defineRule({
  id: "package-version-matches-directory",
  description: "PackageVersion equals the name of the directory the manifest lives in.",
  check(pkg) {
    const file = versionFile(pkg);
    if (!file) return [];

    const value = file.data["PackageVersion"];
    if (typeof value !== "string") return [];

    if (value === pkg.directoryVersion) return [];

    const position = positionOf(file, ["PackageVersion"]);
    const diagnostic: Diagnostic = {
      ruleId: "package-version-matches-directory",
      severity: "error",
      file: file.fileName,
      message: `PackageVersion "${value}" does not match the manifest directory name "${pkg.directoryVersion}".`,
      ...(position === undefined ? {} : { position }),
    };

    return [diagnostic];
  },
});
