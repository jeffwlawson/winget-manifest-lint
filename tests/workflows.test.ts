import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

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

/**
 * The only workflows allowed to hold `issues: write`, each with the reason it
 * needs one. Everything else is derived, not listed: a workflow added later is
 * held to the rule on arrival rather than on someone remembering to add it to a
 * list — which is the same granted-but-unnoticed failure the check exists to
 * catch, one level up.
 */
const ISSUES_WRITE_EXEMPT = new Set([
  // Reads the issue and transitions its labels; the permission is used.
  "agent-implement.yml",
  // Files the AGENT_PAT expiry issue. Acts on no PR at all.
  "token-expiry.yml",
]);

const issuesWriteChecked = workflowFiles.filter(
  (f) => !ISSUES_WRITE_EXEMPT.has(path.basename(f)),
);

const indentOf = (s: string): number => s.length - s.trimStart().length;

interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Record<string, string>;
}

interface Job {
  readonly concurrency?: { readonly group?: string; readonly "cancel-in-progress"?: boolean };
  readonly steps?: readonly Step[];
}

/**
 * The single job each agent workflow declares. Parsed rather than pattern
 * matched: the checks below are about step *order* and which step carries which
 * `if:`, and a regex over the raw text cannot see either.
 */
const jobOf = (file: string): Job => {
  const doc = parse(fs.readFileSync(file, "utf8")) as { jobs: Record<string, Job> };
  const jobs = Object.values(doc.jobs);

  expect(jobs).toHaveLength(1);
  return jobs[0] as Job;
};

const stepsOf = (file: string): readonly Step[] => jobOf(file).steps ?? [];

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

  /**
   * `docs/parity.md` §10: an agent that raises work never files it. The
   * permission is what makes that technical rather than conventional, so it has
   * to stay absent from everything outside `ISSUES_WRITE_EXEMPT` — including
   * `review`, which was granted it unused (#101). Granted-but-unused reads as
   * sanctioned to the next person editing the file.
   */
  it.each(issuesWriteChecked)("%s: grants no issues: write", (file) => {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const inRun = runBlockLines(lines);

    const offenders = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line, n }) => !inRun.has(n) && /^\s*issues:\s*write\s*$/.test(line))
      .map(({ n }) => `${file}:${n}`);

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

/**
 * One group per PR, across every workflow that touches it (#102). Review used
 * to sit in `agent-review-pr-*` while fix and update-branch shared
 * `agent-mutate-pr-*`, so a review could diff a branch *while* a fix pushed to
 * it — a review of a tree state that never existed. The hazard is review
 * reading during another job's write, which its `contents: read` does nothing
 * to prevent.
 */
describe("every PR workflow shares one concurrency group per PR", () => {
  const PR_GROUP = "agent-pr-${{ github.event.pull_request.number }}";

  it.each(PR_WORKFLOWS)("%s: is in the per-PR group, first-come", (file) => {
    const { concurrency } = jobOf(file);

    expect(concurrency?.group).toBe(PR_GROUP);
    expect(concurrency?.["cancel-in-progress"]).toBe(false);
  });

  /**
   * A group declared at workflow level too would put the same job in two
   * groups, which GitHub rejects; a second job-level one would mean a second
   * job, which `jobOf` already refuses.
   */
  /**
   * Sharing a group turns review's CI wait into a trap: a `fix` labelled
   * mid-review is queued behind it, a queued job is a check run in a
   * non-completed state, and review would spend 15 of its 20 minutes waiting
   * for a job that cannot start until review ends. Every agent job is excluded
   * from the wait, not just review's own.
   */
  it("agent-review waits on no agent job", () => {
    const wait = stepsOf(path.join(WORKFLOW_DIR, "agent-review.yml")).find((s) =>
      (s.name ?? "").startsWith("Wait for other checks"),
    );
    const excluded = wait?.env?.["AGENT_CHECKS"] ?? "";

    for (const job of ["review", "fix", "update-branch", "implement"]) {
      expect(excluded).toContain(job);
    }
    expect(wait?.run ?? "").toContain("AGENT_CHECKS");
  });

  it.each(PR_WORKFLOWS)("%s: declares exactly one group", (file) => {
    const groups = [...fs.readFileSync(file, "utf8").matchAll(/^\s*group:\s*(.+)$/gm)].map((m) =>
      (m[1] ?? "").trim(),
    );

    expect(groups).toEqual([PR_GROUP]);
  });
});

/**
 * A closed or merged PR is refused before any work happens. `agent-review` had
 * no guard at all: labelling a merged PR ran a full agent pass over merged
 * work, then failed at `gh pr ready` — which cannot convert a merged PR — and
 * blamed a missing `AGENT_PAT` for it (#102).
 */
describe("PR workflows refuse a closed or merged PR", () => {
  it.each(PR_WORKFLOWS)("%s: reads the PR state from the event", (file) => {
    const text = fs.readFileSync(file, "utf8");

    expect(text).toContain("PR_STATE: ${{ github.event.pull_request.state }}");
    expect(text).toContain("PR_MERGED: ${{ github.event.pull_request.merged }}");
  });

  it.each(PR_WORKFLOWS)("%s: the guard is the first step and is itself ungated", (file) => {
    const first = stepsOf(file)[0];

    expect(first?.id).toBe("state");
    expect(first?.if).toBeUndefined();
    expect(first?.run ?? "").toContain('"$PR_STATE" != "open"');
    expect(first?.run ?? "").toContain('"$PR_MERGED" = "true"');
  });

  /**
   * The two things a refused run must not have done: checked the branch out,
   * and told the PR an agent is working on it. Both are asserted on the step
   * that does them rather than on step order, so moving a step cannot quietly
   * escape the guard.
   */
  const PROCEED = "steps.state.outputs.proceed == 'true'";

  it.each(PR_WORKFLOWS)("%s: checkout is gated on the guard", (file) => {
    const checkout = stepsOf(file).filter((s) => (s.uses ?? "").startsWith("actions/checkout@"));

    expect(checkout).not.toHaveLength(0);
    for (const step of checkout) expect(step.if ?? "").toContain(PROCEED);
  });

  it.each(PR_WORKFLOWS)("%s: the run never enters agent:in-progress", (file) => {
    const labelling = stepsOf(file).filter((s) => (s.run ?? "").includes('--add-label "agent:in-progress"'));

    expect(labelling).not.toHaveLength(0);
    for (const step of labelling) expect(step.if ?? "").toContain(PROCEED);
  });
});

/**
 * The issue-side equivalent (#102). `agent-implement`'s preflight only listed
 * *open* PRs, so a merged-and-closed issue that got relabelled checked out
 * `main`, found the work already there, and died at "no commits were made" —
 * or, worse, invented a spurious change and opened a duplicate PR.
 */
describe("agent-implement refuses a closed issue", () => {
  const FILE = path.join(WORKFLOW_DIR, "agent-implement.yml");

  it("reads the issue state from the event", () => {
    expect(fs.readFileSync(FILE, "utf8")).toContain(
      "ISSUE_STATE: ${{ github.event.issue.state }}",
    );
  });

  it("refuses before the existing-PR query, with its own message", () => {
    const preflight = stepsOf(FILE)[0];
    const run = preflight?.run ?? "";

    expect(preflight?.id).toBe("preflight");
    expect(run).toContain('"$ISSUE_STATE" != "open"');
    expect(run).toContain("this issue is not open");
    // Distinct from the refusal that was already there — two refusals reading
    // the same is two states a human cannot tell apart from the comment alone.
    expect(run).toContain("already targets this issue");
    expect(run.indexOf("$ISSUE_STATE")).toBeLessThan(run.indexOf("gh pr list"));
  });

  it("checks nothing out when it refuses", () => {
    const checkout = stepsOf(FILE).filter((s) => (s.uses ?? "").startsWith("actions/checkout@"));

    expect(checkout).not.toHaveLength(0);
    for (const step of checkout) {
      expect(step.if ?? "").toContain("steps.preflight.outputs.refused == 'false'");
    }
  });
});
