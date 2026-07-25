import type { Diagnostic, Position } from "../diagnostic.js";
import { installerFile, positionOf, type ManifestFile } from "../manifest.js";
import { defineRule } from "./rule.js";

/**
 * An archive installer (`InstallerType: zip`) does not run its download
 * directly — winget unpacks it and runs a file from inside. So it needs two
 * extra fields, and winget-cli rejects the manifest without them
 * (`ManifestValidation.cpp`: "NestedInstallerType/NestedInstallerFiles is
 * required for zip installerType"):
 *
 * - `NestedInstallerType` — what the unpacked file is (`exe`, `portable`, …);
 * - `NestedInstallerFiles` — at least one entry naming a `RelativeFilePath`
 *   inside the archive to run.
 *
 * The converse is also an error: those fields are meaningless on a non-archive
 * installer (there is nothing to unpack), and winget rejects them there too.
 *
 * This is a cross-field, within-a-file rule (see CONTEXT.md): each field is
 * only valid given the installer's `InstallerType`. As with the other installer
 * fields, `InstallerType`, `NestedInstallerType` and `NestedInstallerFiles` may
 * be declared once at the root as defaults and overridden per installer, so we
 * resolve each entry's effective values before judging it — honouring a
 * per-installer `InstallerType` that overrides the file-level default.
 */
const ARCHIVE_TYPES = new Set(["zip"]);

export default defineRule({
  id: "nested-installer-compatibility",
  description:
    "NestedInstallerType and NestedInstallerFiles are present exactly when the InstallerType is an archive (zip).",
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
      const nestedType = stringOrUndefined(record["NestedInstallerType"]) ?? rootNestedType;
      const nestedFiles = arrayOrUndefined(record["NestedInstallerFiles"]) ?? rootNestedFiles;

      if (isArchive(type)) {
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
        return;
      }

      const present: string[] = [];
      if (nestedType !== undefined) present.push("NestedInstallerType");
      if (nestedFiles !== undefined && nestedFiles.length > 0) present.push("NestedInstallerFiles");
      if (present.length === 0) return;

      diagnostics.push(
        diagnostic(
          file,
          nestedPosition(file, index),
          `Installer entry ${index} has a non-archive InstallerType (${label(type)}) but declares ${present.join(" and ")}. Nested installer fields apply only to archive installers such as zip.`,
        ),
      );
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

/**
 * Point at the nested field that made a non-archive installer invalid. Prefer
 * the installer's own declaration; fall back to the inherited root default, and
 * finally to the installer entry itself.
 */
function nestedPosition(file: ManifestFile, index: number): Position | undefined {
  return (
    positionOf(file, ["Installers", index, "NestedInstallerType"]) ??
    positionOf(file, ["Installers", index, "NestedInstallerFiles"]) ??
    positionOf(file, ["NestedInstallerType"]) ??
    positionOf(file, ["NestedInstallerFiles"]) ??
    positionOf(file, ["Installers", index])
  );
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

function isArchive(type: string | undefined): boolean {
  return type !== undefined && ARCHIVE_TYPES.has(type.toLowerCase());
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function arrayOrUndefined(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/** Render a field, distinguishing an absent value from a real one. */
function label(value: string | undefined): string {
  return value === undefined ? "(none)" : value;
}
