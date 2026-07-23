/**
 * Lint a corpus of real winget manifests and fail if any rule fires.
 *
 * The premise (see CONTEXT.md): every manifest Microsoft has accepted into
 * `microsoft/winget-pkgs` is known-good. So any diagnostic this linter emits
 * against that corpus is, by definition, a false positive in one of our rules.
 * This script is the regression oracle that surfaces those false positives.
 *
 * It is deliberately NOT part of the shipped library and NOT part of
 * `npm run verify` — it needs a multi-gigabyte external checkout and belongs in
 * its own CI job.
 *
 * Usage:
 *   CORPUS_DIR=/path/to/winget-pkgs [MAX_PACKAGES=3000] tsx scripts/lint-corpus.ts
 *
 * Exit codes: 0 = clean, 1 = at least one diagnostic, 2 = bad invocation.
 */
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { compareDiagnostics, lintDirectory, type Diagnostic } from "../src/index.js";

const CORPUS_DIR = process.env["CORPUS_DIR"];
const MAX_PACKAGES = Number(process.env["MAX_PACKAGES"] ?? "3000");
const PRINT_LIMIT = 50;

if (!CORPUS_DIR) {
  console.error("CORPUS_DIR is required (path to a winget-pkgs checkout).");
  process.exit(2);
}
if (!Number.isInteger(MAX_PACKAGES) || MAX_PACKAGES <= 0) {
  console.error(`MAX_PACKAGES must be a positive integer, got "${process.env["MAX_PACKAGES"]}".`);
  process.exit(2);
}

/**
 * A version directory is any directory that *directly* contains a manifest
 * YAML file. In winget-pkgs, YAML lives only in version directories
 * (`manifests/<letter>/<Publisher>/<Package>/<Version>/`), so the parent of
 * every `.yaml` file is exactly the set we want.
 */
async function findVersionDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  const dirs = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.ya?ml$/i.test(entry.name)) continue;
    // Node's recursive Dirent carries the containing dir on parentPath.
    dirs.add(entry.parentPath);
  }
  return [...dirs].sort();
}

/**
 * Stride-sample down to at most `max` entries. Striding across the sorted list
 * keeps coverage spread across the whole alphabet rather than clustering on the
 * first few publishers, and it is deterministic — the same corpus always yields
 * the same sample, so a failure reproduces.
 */
function sample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const stride = Math.floor(items.length / max);
  const out: T[] = [];
  for (let i = 0; i < items.length && out.length < max; i += stride) {
    const item = items[i];
    if (item !== undefined) out.push(item);
  }
  return out;
}

// A real winget-pkgs checkout nests everything under `manifests/`; scan that
// when present, but fall back to the given directory so the walker can be
// pointed at any tree (e.g. tests/fixtures) for a smoke test.
const manifestsRoot = await stat(join(CORPUS_DIR, "manifests"))
  .then((s) => (s.isDirectory() ? join(CORPUS_DIR, "manifests") : CORPUS_DIR))
  .catch(() => CORPUS_DIR);
console.log(`Scanning ${manifestsRoot} for version directories…`);

const allDirs = await findVersionDirectories(manifestsRoot).catch((error: unknown) => {
  console.error(`Could not scan corpus: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});

if (allDirs.length === 0) {
  console.error(`No manifest directories found under ${manifestsRoot}. Wrong CORPUS_DIR?`);
  process.exit(2);
}

const selected = sample(allDirs, MAX_PACKAGES);
console.log(
  `Found ${allDirs.length} version directories; linting ${selected.length} ` +
    `(MAX_PACKAGES=${MAX_PACKAGES}).`,
);

const findings: Diagnostic[] = [];
let linted = 0;
for (const dir of selected) {
  const diagnostics = await lintDirectory(dir).catch((error: unknown): Diagnostic[] => {
    // A directory we cannot even parse is itself a finding — the linter should
    // never throw on real input. Surface it rather than swallowing it.
    return [
      {
        ruleId: "corpus-harness-error",
        severity: "error",
        message: `lintDirectory threw: ${error instanceof Error ? error.message : String(error)}`,
        file: relative(CORPUS_DIR, dir).split(sep).join("/"),
      },
    ];
  });

  for (const d of diagnostics) {
    findings.push({ ...d, file: `${relative(CORPUS_DIR, dir).split(sep).join("/")}/${d.file}` });
  }

  linted++;
  if (linted % 500 === 0) {
    console.log(`  …${linted}/${selected.length} linted, ${findings.length} diagnostics so far.`);
  }
}

findings.sort(compareDiagnostics);

console.log(`\nLinted ${linted} version directories.`);
console.log(`Diagnostics: ${findings.length}.`);

if (findings.length === 0) {
  console.log("\nClean. No rule fired against the corpus.");
  process.exit(0);
}

console.log(`\nFirst ${Math.min(PRINT_LIMIT, findings.length)} diagnostic(s) — each is a false positive to fix:\n`);
for (const d of findings.slice(0, PRINT_LIMIT)) {
  const pos = d.position ? `:${d.position.line}:${d.position.column}` : "";
  console.log(`  ${d.file}${pos}  ${d.severity}  ${d.message}  [${d.ruleId}]`);
}
if (findings.length > PRINT_LIMIT) {
  console.log(`  … and ${findings.length - PRINT_LIMIT} more.`);
}

// Surface which rules are implicated, since that is what actually needs fixing.
const byRule = new Map<string, number>();
for (const d of findings) byRule.set(d.ruleId, (byRule.get(d.ruleId) ?? 0) + 1);
console.log("\nBy rule:");
for (const [ruleId, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(6)}  ${ruleId}`);
}

process.exit(1);
