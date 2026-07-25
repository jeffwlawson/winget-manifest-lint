import type { Diagnostic, Position } from "../diagnostic.js";
import {
  installerFile,
  isArchiveType,
  positionOf,
  stringOrUndefined,
  type ManifestFile,
} from "../manifest.js";
import { defineRule } from "./rule.js";

/**
 * An archive installer (`InstallerType: zip`) does not run its download
 * directly — winget unpacks it and runs a file from inside. So it needs two
 * extra fields, and winget-cli rejects the manifest without them
 * (`ManifestValidation.cpp`, ~line 323: the nested-installer validation block
 * is guarded by `if (IsArchiveType(installer.BaseInstallerType))` and requires
 * both `NestedInstallerType` and `NestedInstallerFiles` inside it):
 *
 * - `NestedInstallerType` — what the unpacked file is (`exe`, `portable`, …);
 * - `NestedInstallerFiles` — at least one entry naming a `RelativeFilePath`
 *   inside the archive to run.
 *
 * There is no converse check. That `if (IsArchiveType(...))` block has no
 * `else`: winget performs no nested-field validation on non-archive types and
 * simply ignores stray nested fields. Flagging them would be a false positive —
 * e.g. a `portable` installer routinely carries `NestedInstallerFiles` to
 * declare its `PortableCommandAlias`. So this rule only checks the
 * archive-requires-nested direction.
 *
 * This is a cross-field, within-a-file rule (see CONTEXT.md): the nested fields
 * are only required given the installer's `InstallerType`. As with the other
 * installer fields, `InstallerType`, `NestedInstallerType` and
 * `NestedInstallerFiles` may be declared once at the root as defaults and
 * overridden per installer, so we resolve each entry's effective values before
 * judging it — honouring a per-installer `InstallerType` that overrides the
 * file-level default.
 */
export default defineRule({
  id: "nested-installer-compatibility",
  description:
    "An archive InstallerType (zip) declares NestedInstallerType and a NestedInstallerFiles entry with a RelativeFilePath.",
  check(pkg) {
    const file = installerFile(pkg);
    if (!file) return [];

    const installers = file.data["Installers"];
    if (!Array.isArray(installers)) return [];

    const rootType = stringOrUndefined(file.data["InstallerType"]);
    const rootNestedType = stringOrUndefined(file.data["NestedInstallerType"]);
    const rootNestedFiles = arrayOrUndefined(file.data["NestedInstallerFiles"]);

    const diagnostics: Diagnostic[] = [];

    installers.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return;
      const record = entry as Record<string, unknown>;

      const type = stringOrUndefined(record["InstallerType"]) ?? rootType;
      if (!isArchiveType(type)) return;

      const nestedType = stringOrUndefined(record["NestedInstallerType"]) ?? rootNestedType;
      const nestedFiles = arrayOrUndefined(record["NestedInstallerFiles"]) ?? rootNestedFiles;

      if (nestedType === undefined) {
        diagnostics.push(
          diagnostic(
            file,
            positionOf(file, ["Installers", index]),
            `Installer entry ${index} has an archive InstallerType (${type}) but no NestedInstallerType. An archive installer must declare what it unpacks to.`,
          ),
        );
      }
      if (!hasRelativeFilePath(nestedFiles)) {
        diagnostics.push(
          diagnostic(
            file,
            positionOf(file, ["Installers", index]),
            `Installer entry ${index} has an archive InstallerType (${type}) but no NestedInstallerFiles entry with a RelativeFilePath. winget needs to know which unpacked file to run.`,
          ),
        );
      }
    });

    return diagnostics;
  },
});

function diagnostic(file: ManifestFile, position: Position | undefined, message: string): Diagnostic {
  return {
    ruleId: "nested-installer-compatibility",
    severity: "error",
    file: file.fileName,
    message,
    ...(position === undefined ? {} : { position }),
  };
}

/** An archive holds no runnable file unless one entry names a RelativeFilePath. */
function hasRelativeFilePath(files: unknown[] | undefined): boolean {
  return (
    files !== undefined &&
    files.some(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>)["RelativeFilePath"] === "string",
    )
  );
}

function arrayOrUndefined(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
