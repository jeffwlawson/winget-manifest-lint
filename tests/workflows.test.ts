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

/**
 * Line numbers (1-based) GitHub hands to the shell: the body of a `run:` block
 * scalar, and a single-line `run: <command>`. The inline form matters —
 * `agent-review.yml`'s base fetch is written that way, so a check that only
 * walked block scalars would pass over the very line #71 fixed.
 */
const runBlockLines = (lines: readonly string[]): ReadonlySet<number> => {
  const inside = new Set<number>();
  let runIndent: number | null = null;

  for (const [i, line] of lines.entries()) {
    if (/^\s*(- )?run:\s*[|>]/.test(line ?? "")) {
      runIndent = indentOf(line ?? "");
      continue;
    }
    if (/^\s*(- )?run:\s*\S/.test(line ?? "")) {
      inside.add(i + 1);
      runIndent = null;
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
   * The word, not just `origin/main`. The failure class is "a git verb was
   * handed `main`", which `git merge main --no-edit`, `git rev-parse main` and
   * `base="main"` all are while matching no `origin/`-shaped pattern.
   *
   * Two exemptions, both narrow. Shell lines only, so a YAML comment may still
   * say `origin/main` while explaining the fallback. And `${VAR:-main}` is
   * stripped before the check: that *is* the fallback, reached only when
   * `base.ref` is somehow empty.
   */
  const FALLBACK = /\$\{[A-Za-z_][A-Za-z0-9_]*:-main\}/g;

  it.each(PR_WORKFLOWS)("%s: no shell line names main as a branch", (file) => {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const inRun = runBlockLines(lines);

    const offenders = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line, n }) => inRun.has(n) && !/^\s*#/.test(line))
      .filter(({ line }) => /\bmain\b/.test(line.replace(FALLBACK, "")))
      .map(({ line, n }) => `${file}:${n} ${line.trim()}`);

    expect(offenders).toEqual([]);
  });

  /**
   * The prompt tells the agent which merge it is cleaning up after. Naming
   * `main` there on a stacked PR sends it reading the wrong branch's history to
   * reconcile a conflict that came from somewhere else.
   *
   * `extraction.md` is checked too, and is the one that bites hardest: on the
   * conflicts path its output *is* the comment posted to the PR, and it cannot
   * be templated — `runWithExtraction` drops `promptArgs` before the extraction
   * run, so a `{{BASE_REF}}` there would arrive literal. A `main`-shaped
   * few-shot is the whole steer it gets.
   */
  it.each(["prompt.md", "extraction.md"])(
    "update-branch/%s does not hardcode main",
    (name: string) => {
      const text = fs.readFileSync(`.sandcastle/agent-workflows/update-branch/${name}`, "utf8");

      expect(text).not.toMatch(/\borigin\/main\b|`main`/);
    },
  );

  it("update-branch/prompt.md is templated with the base ref", () => {
    const prompt = fs.readFileSync(".sandcastle/agent-workflows/update-branch/prompt.md", "utf8");

    expect(prompt).toContain("{{BASE_REF}}");
  });
});
