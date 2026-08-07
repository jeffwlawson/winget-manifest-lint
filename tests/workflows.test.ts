import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards `.github/workflows/**` against a failure class nothing else here
 * catches. `npm run verify` typechecks and runs tests; it never parses the
 * workflow files. So an invalid one reaches `main` with every check green and
 * then fails at *startup* — zero jobs, no log, and the run surfaces only under
 * `push` events the workflow was never meant to handle.
 *
 * `agent-fix.yml` was down that way for two days. The trigger was a comment
 * *about* expression interpolation that contained a literal empty expression.
 *
 * The rule being encoded: **GitHub evaluates `${{ … }}` everywhere except YAML
 * comments** — including inside a `run:` block, where a `#` line is a comment
 * to bash but still an expression host to GitHub. That is the whole distinction
 * between the harmless note in `agent-review.yml` and the fatal one that was in
 * `agent-fix.yml`.
 */

const WORKFLOW_DIR = ".github/workflows";

/**
 * The three PR workflows that act on a PR's branch. Every one of them has to
 * work against the PR's *real* base, not a hardcoded `main` (#71, #100).
 */
const PR_WORKFLOWS = ["agent-review.yml", "agent-fix.yml", "agent-update-branch.yml"].map((f) =>
  path.join(WORKFLOW_DIR, f),
);

const workflowFiles = fs
  .readdirSync(WORKFLOW_DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((f) => path.join(WORKFLOW_DIR, f));

const indentOf = (s: string): number => s.length - s.trimStart().length;

/** Line numbers (1-based) that sit inside a `run:` block scalar. */
const runBlockLines = (lines: readonly string[]): ReadonlySet<number> => {
  const inside = new Set<number>();
  let runIndent: number | null = null;

  for (const [i, line] of lines.entries()) {
    if (/^\s*(- )?run:\s*[|>]/.test(line ?? "")) {
      runIndent = indentOf(line ?? "");
      continue;
    }
    if (runIndent === null) continue;

    // The block ends at the first non-blank line indented no further than the
    // `run:` key itself.
    if ((line ?? "").trim() !== "" && indentOf(line ?? "") <= runIndent) {
      runIndent = null;
      continue;
    }
    inside.add(i + 1);
  }
  return inside;
};

describe("workflow files", () => {
  it("finds workflows to check", () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
  });

  /**
   * An empty `${{ }}` is not inert — GitHub tries to evaluate it and rejects
   * the entire file with "An expression was expected". It is also the exact
   * shape you reach for when writing *about* interpolation, which is how it
   * gets in.
   *
   * A YAML comment is exempt because GitHub never reads one. A `#` line inside
   * a `run:` block is NOT a YAML comment and gets no exemption.
   */
  it.each(workflowFiles)("%s: no empty expression where GitHub evaluates", (file) => {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const inRun = runBlockLines(lines);

    const offenders = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line, n }) => {
        const isYamlComment = /^\s*#/.test(line) && !inRun.has(n);
        return !isYamlComment && /\$\{\{\s*\}\}/.test(line);
      })
      .map(({ line, n }) => `${file}:${n} ${line.trim()}`);

    expect(offenders).toEqual([]);
  });

  /**
   * Even a *non-empty* expression in a run-block comment is wrong: GitHub
   * substitutes it before bash ever sees the line, so the comment silently
   * stops saying what it was written to say. Prose about expressions belongs at
   * step level.
   */
  it.each(workflowFiles)("%s: no expression inside a run-block comment", (file) => {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const inRun = runBlockLines(lines);

    const offenders = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line, n }) => inRun.has(n) && /^\s*#/.test(line) && line.includes("${{"))
      .map(({ line, n }) => `${file}:${n} ${line.trim()}`);

    expect(offenders).toEqual([]);
  });
});

/**
 * A hardcoded `main` in a PR workflow is the #71/#100 failure class: on a PR
 * stacked on another branch every git operation silently addresses the wrong
 * branch — no error, wrong result. `agent-review.yml` and `agent-fix.yml` were
 * fixed in #71 and `agent-update-branch.yml` in #100; these keep all three
 * fixed, since nothing else here reads a workflow file.
 */
describe("PR workflows work against the PR's base ref", () => {
  it.each(PR_WORKFLOWS)("%s: declares BASE_REF in the job env", (file) => {
    expect(fs.readFileSync(file, "utf8")).toContain(
      "BASE_REF: ${{ github.event.pull_request.base.ref }}",
    );
  });

  /**
   * Only `run:` blocks — a YAML comment may say `origin/main` while explaining
   * the fallback, and `${BASE_REF:-main}` is the fallback itself, not a
   * hardcode.
   */
  it.each(PR_WORKFLOWS)("%s: no git operation names a literal main ref", (file) => {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const inRun = runBlockLines(lines);

    const offenders = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line, n }) => inRun.has(n) && !/^\s*#/.test(line))
      .filter(({ line }) => /\borigin\/main\b|\brefs\/heads\/main\b/.test(line))
      .map(({ line, n }) => `${file}:${n} ${line.trim()}`);

    expect(offenders).toEqual([]);
  });

  /**
   * The prompt tells the agent which merge it is cleaning up after. Naming
   * `main` there on a stacked PR sends it reading the wrong branch's history to
   * reconcile a conflict that came from somewhere else.
   */
  it("update-branch/prompt.md names the base ref rather than main", () => {
    const prompt = fs.readFileSync(".sandcastle/agent-workflows/update-branch/prompt.md", "utf8");

    expect(prompt).toContain("{{BASE_REF}}");
    expect(prompt).not.toMatch(/\borigin\/main\b|`main`/);
  });
});
