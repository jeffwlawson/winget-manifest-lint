import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { LineCounter, parseDocument, type Document } from "yaml";
import type { Diagnostic, Position } from "./diagnostic.js";

/**
 * A file's role is derived from its *name*, never from its contents. The
 * `ManifestType` field inside the file is a separate claim, and a rule exists
 * purely to check the two agree — so the parser must not conflate them.
 *
 * Note that `defaultLocale` is not a role: a default-locale manifest is a
 * `locale` file whose `ManifestType` happens to say `defaultLocale`.
 */
export type ManifestRole = "version" | "installer" | "locale";

export interface ManifestFile {
  /** Relative to the manifest directory. */
  fileName: string;
  role: ManifestRole;
  /** The `<tag>` in `<id>.locale.<tag>.yaml`. Only set for `locale` files. */
  localeTag?: string;
  /** Parsed scalar tree. Empty object if the file parsed to nothing useful. */
  data: Record<string, unknown>;
  doc: Document;
  lineCounter: LineCounter;
}

export interface ManifestPackage {
  /** Absolute path to the version directory. */
  directory: string;
  /** The directory's own name, which must equal `PackageVersion` (rule #19). */
  directoryVersion: string;
  files: ManifestFile[];
}

export interface ParseResult {
  pkg: ManifestPackage;
  /** Parse-level problems only: unreadable, unparseable, or unrecognised files. */
  diagnostics: Diagnostic[];
}

const INSTALLER_PATTERN = /\.installer\.ya?ml$/i;
const LOCALE_PATTERN = /\.locale\.([A-Za-z0-9-]+)\.ya?ml$/i;
const YAML_PATTERN = /\.ya?ml$/i;

function roleOf(fileName: string): { role: ManifestRole; localeTag?: string } {
  if (INSTALLER_PATTERN.test(fileName)) return { role: "installer" };
  const locale = LOCALE_PATTERN.exec(fileName);
  if (locale?.[1]) return { role: "locale", localeTag: locale[1] };
  return { role: "version" };
}

/**
 * Resolve a dotted/indexed path to a source position, so a rule can say
 * *where* a value is wrong rather than just that it is.
 *
 * Returns undefined when the path does not exist — a rule reporting a missing
 * key legitimately has no position for it.
 */
export function positionOf(
  file: ManifestFile,
  path: ReadonlyArray<string | number>,
): Position | undefined {
  if (path.length === 0) return undefined;
  const node = file.doc.getIn([...path], true) as { range?: [number, number, number] } | undefined;
  const offset = node?.range?.[0];
  if (offset === undefined) return undefined;
  const { line, col } = file.lineCounter.linePos(offset);
  return { line, column: col };
}

/** Convenience accessors — every cross-file rule needs these. */
export function versionFile(pkg: ManifestPackage): ManifestFile | undefined {
  return pkg.files.find((f) => f.role === "version");
}

export function installerFile(pkg: ManifestPackage): ManifestFile | undefined {
  return pkg.files.find((f) => f.role === "installer");
}

export function localeFiles(pkg: ManifestPackage): ManifestFile[] {
  return pkg.files.filter((f) => f.role === "locale");
}

/**
 * Parse a version directory into a typed model.
 *
 * Never throws for bad input — a manifest being broken is the normal case this
 * tool exists to report. Only a genuinely unreadable *directory* rejects.
 */
export async function parseManifestDirectory(directory: string): Promise<ParseResult> {
  const diagnostics: Diagnostic[] = [];
  const files: ManifestFile[] = [];

  const entries = await readdir(directory, { withFileTypes: true });
  const yamlNames = entries
    .filter((e) => e.isFile() && YAML_PATTERN.test(e.name))
    .map((e) => e.name)
    .sort();

  for (const fileName of yamlNames) {
    let source: string;
    try {
      source = await readFile(join(directory, fileName), "utf8");
    } catch (error) {
      diagnostics.push({
        ruleId: "parse-unreadable",
        severity: "error",
        message: `Could not read file: ${error instanceof Error ? error.message : String(error)}`,
        file: fileName,
      });
      continue;
    }

    const lineCounter = new LineCounter();
    const doc = parseDocument(source, { lineCounter });

    for (const error of doc.errors) {
      const { line, col } = lineCounter.linePos(error.pos[0]);
      diagnostics.push({
        ruleId: "parse-invalid-yaml",
        severity: "error",
        message: error.message,
        file: fileName,
        position: { line, column: col },
      });
    }

    // A file with syntax errors still yields a partial tree. Keep it: later
    // rules can often still say something useful, and dropping it would
    // produce a confusing cascade of "missing file" diagnostics.
    const parsed: unknown = doc.errors.length > 0 ? doc.toJS({ maxAliasCount: -1 }) : doc.toJS();
    const data =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};

    const { role, localeTag } = roleOf(fileName);
    files.push({
      fileName,
      role,
      ...(localeTag === undefined ? {} : { localeTag }),
      data,
      doc,
      lineCounter,
    });
  }

  return {
    pkg: {
      directory,
      directoryVersion: basename(directory),
      files,
    },
    diagnostics,
  };
}
