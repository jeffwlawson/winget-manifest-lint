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

const REVIEW = path.join(WORKFLOW_DIR, "agent-review.yml");

/** `agent-review`'s CI-collection step, which several checks below pick apart. */
const waitStep = (): Step => {
  const step = stepsOf(REVIEW).find((s) => (s.name ?? "").startsWith("Wait for other checks"));

  expect(step).toBeDefined();
  return step as Step;
};

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
   * Sharing a group turns review's CI wait into a trap: a `fix` labelled
   * mid-review is queued behind it, a queued job is a check run in a
   * non-completed state, and review would spend 15 of its 20 minutes waiting
   * for a job that cannot start until review ends. Every agent job is excluded
   * from the wait, not just review's own.
   */
  it("agent-review waits on no agent job", () => {
    const excluded = waitStep().env?.["AGENT_CHECKS"] ?? "";

    for (const job of ["review", "fix", "update-branch", "implement"]) {
      expect(excluded).toContain(job);
    }
    // Both jq filters — the one that decides whether to keep waiting and the
    // one that writes the list into the prompt. A pattern only the second used
    // would still deadlock on a queued agent job.
    const filters = [...(waitStep().run ?? "").matchAll(/test\(\\"\$\{AGENT_CHECKS\}\\"\)/g)];

    expect(filters).toHaveLength(2);
  });

  /**
   * The same set, one step further on: the failure-log tail skipped only
   * `Agent Review` while the wait above excluded all four, so a failed `Agent
   * Fix` still got 60 lines of its log into the prompt — not evidence about the
   * diff, and crowding out the CI failure that is. Matched on the workflow
   * *run* name, a different namespace from the check names in `AGENT_CHECKS`:
   * every agent workflow is `name: Agent …` and the repo's own are `CI` and
   * `Corpus`, so the prefix is the whole test.
   */
  it("agent-review tails no agent workflow's failure log", () => {
    const run = waitStep().run ?? "";

    expect(run).toContain('case "$rname" in "Agent "*)');
    expect(run).not.toContain('[ "$rname" = "Agent Review" ]');
  });

  /**
   * A group declared at workflow level too would put the same job in two
   * groups, which GitHub rejects; a second job-level one would mean a second
   * job, which `jobOf` already refuses.
   */
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

  const PROCEED = "steps.state.outputs.proceed == 'true'";

  /**
   * The two things a refused run must not have done: checked the branch out,
   * and told the PR an agent is working on it. Both are asserted on the step
   * that does them rather than on step order, so moving a step cannot quietly
   * escape the guard.
   */
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
 * The refusal the shared group made necessary. Review pins everything to the
 * head SHA in its `labeled` payload — the checkout, and `commit_id` on the
 * posted review — and that payload is snapshotted at label time, so a review
 * queued behind a fix starts once the fix has pushed and still reviews the
 * pre-fix commit. Serialising turned reading-during-a-write into
 * reading-after-one; it did not remove the race. The mutates catch their
 * version at push time via `--force-with-lease` on the same SHA, review
 * publishes instead of failing, so it has to check up front.
 */
describe("agent-review refuses a head that moved while it was queued", () => {
  it("compares the payload SHA against the live head, in the guard", () => {
    const guard = stepsOf(REVIEW)[0];
    const run = guard?.run ?? "";

    expect(guard?.env?.["HEAD_SHA"]).toBe("${{ github.event.pull_request.head.sha }}");
    expect(run).toContain("--json headRefOid");
    expect(run).toContain('"$current" != "$HEAD_SHA"');
    // Distinct from the not-open refusal: same step, two states, and a human
    // reading only the comment has to be able to tell them apart.
    expect(run).toContain("this PR is not open");
    expect(run).toContain("moved while this run was queued");
  });

  /**
   * An unreadable `gh pr view` must not refuse — an API blip is not evidence
   * the branch moved — so the comparison is guarded on a non-empty answer.
   */
  it("proceeds when the live head cannot be read", () => {
    expect(stepsOf(REVIEW)[0]?.run ?? "").toContain('[ -n "$current" ]');
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
    // Ungated, like the three PR guards: a guard with an `if:` is a guard that
    // can be skipped into the work it exists to prevent.
    expect(preflight?.if).toBeUndefined();
    expect(run).toContain('"$ISSUE_STATE" != "open"');
    expect(run).toContain("this issue is not open");
    // Distinct from the refusal that was already there — two refusals reading
    // the same is two states a human cannot tell apart from the comment alone.
    expect(run).toContain("already targets this issue");
    expect(run.indexOf("$ISSUE_STATE")).toBeLessThan(run.indexOf("gh pr list"));
  });

  const NOT_REFUSED = "steps.preflight.outputs.refused == 'false'";

  it("checks nothing out when it refuses", () => {
    const checkout = stepsOf(FILE).filter((s) => (s.uses ?? "").startsWith("actions/checkout@"));

    expect(checkout).not.toHaveLength(0);
    for (const step of checkout) expect(step.if ?? "").toContain(NOT_REFUSED);
  });

  it("never enters agent:in-progress when it refuses", () => {
    const labelling = stepsOf(FILE).filter((s) =>
      (s.run ?? "").includes('--add-label "agent:in-progress"'),
    );

    expect(labelling).not.toHaveLength(0);
    for (const step of labelling) expect(step.if ?? "").toContain(NOT_REFUSED);
  });
});

/**
 * Issue *shape* (#90). An issue's position in a hierarchy decides whether it can
 * be implemented at all, and the workflow used to accept anything carrying the
 * label:
 *
 * - **has a parent** — a sub-issue implemented alone loses the ordering and the
 *   shared context its parent holds; the parent drives it or nobody does.
 * - **has sub-issues** — PRD-shaped, and the path that works sub-issues in
 *   sequence does not exist yet (#92).
 * - **`wayfinder:*`** — maps and decision tickets are planning artifacts. They
 *   describe work; they are not work.
 *
 * All three are refused in the preflight step, which is what keeps them job-level
 * rather than agent-level: no checkout, no `npm ci`, no `agent:in-progress`.
 */
describe("agent-implement refuses issue shapes it cannot handle", () => {
  const FILE = path.join(WORKFLOW_DIR, "agent-implement.yml");
  const preflightRun = (): string => stepsOf(FILE)[0]?.run ?? "";

  /**
   * One query, not three. Parent and sub-issue count come back together —
   * asking twice is two chances to see a different answer, and the shape is
   * what every refusal below branches on.
   */
  it("computes the shape once, from a single API call", () => {
    const run = preflightRun();

    expect([...run.matchAll(/gh api graphql/g)]).toHaveLength(1);
    expect(run).toContain("parent {");
    expect(run).toContain("subIssues(");
  });

  it("exposes the shape as a step output", () => {
    expect(preflightRun()).toContain('echo "shape=$shape" >> "$GITHUB_OUTPUT"');
  });

  /**
   * Three refusals, three messages. A human reading only the comment has to be
   * able to tell which of the three shapes they hit — the remedy differs for
   * each, and "refused" alone sends them to the run log.
   */
  it.each([
    ["a sub-issue", "sub-issue of"],
    ["a PRD-shaped parent", "sub-issue(s)"],
    ["a wayfinder ticket", "planning artifact"],
  ])("refuses %s with its own message", (_shape: string, phrase: string) => {
    expect(preflightRun()).toContain(phrase);
  });

  /**
   * The PRD refusal has to say the path is *pending*, not that the issue is
   * wrong. It is the one shape that becomes implementable later (#92) without
   * anyone editing the issue.
   */
  it("names the PRD path as pending rather than rejecting the issue", () => {
    expect(preflightRun()).toMatch(/PRD path[^\n]*not built yet/);
  });

  /**
   * Unlike the state and existing-PR refusals — "reopen it", "close that PR" —
   * a shape refusal is durable: nothing about the run will differ next time.
   * `agent:blocked` is what records that on the issue.
   */
  it("marks a shape refusal blocked, in the preflight step itself", () => {
    const run = preflightRun();

    expect(run).toContain('--add-label "agent:blocked"');
    expect(run).toContain('--remove-label "agent:implement"');
  });

  /**
   * An unreadable shape must not be read as "standalone". Every other guard in
   * these workflows proceeds when an API call comes back empty; this one is the
   * exception, because guessing wrong here *is* the isolation bug. Failing the
   * step leaves the trigger label in place and the run visibly red.
   */
  it("does not swallow a failed shape query", () => {
    // Keyed on the tolerance, not the command: `|| true` would land on the
    // *closing* line of a multi-line query, several lines below the one
    // naming `gh`, so a filter on `gh api graphql` never sees it.
    const tolerant = preflightRun()
      .split("\n")
      .filter((l) => l.includes("|| true") && !l.trimStart().startsWith("#"));

    expect(tolerant).not.toHaveLength(0);
    for (const line of tolerant) expect(line).toContain("gh issue edit");
  });

  const NOT_REFUSED = "steps.preflight.outputs.refused == 'false'";

  /**
   * Refusing to swallow a failed shape query only helps if the failure reaches
   * the issue. A preflight that dies mid-step writes no `refused` output at
   * all, and `''` is not `'false'` — so the failure notice has to be gated on
   * `!= 'true'`, or the one step that comments the reason is skipped exactly
   * when the reason is a red run nobody is watching.
   */
  it("comments on a preflight that fails rather than refuses", () => {
    // Identified by the reason file, not by `agent:blocked` — the preflight
    // step adds that label too, and it sorts first.
    const blocked = stepsOf(FILE).find((s) => (s.run ?? "").includes("failure_reason.txt"));

    expect(blocked?.if ?? "").toContain("steps.preflight.outputs.refused != 'true'");
    expect(blocked?.if ?? "").toContain("failure()");
  });

  /**
   * The job-level `if:` saves a runner for the wrong *label*; this saves the
   * expensive half of the run for the wrong *issue*. `agent-implement.yml:9-12`
   * records why that distinction is worth keeping.
   */
  it("installs nothing when it refuses", () => {
    const install = stepsOf(FILE).filter(
      (s) => (s.run ?? "").includes("npm ci") || (s.uses ?? "").startsWith("actions/setup-node@"),
    );

    expect(install).not.toHaveLength(0);
    for (const step of install) expect(step.if ?? "").toContain(NOT_REFUSED);
  });

  /**
   * Shape is settled before the existing-PR query. An issue that must never be
   * implemented should not be told "close that PR, then re-add the label" — a
   * remedy that leads straight back to a refusal.
   */
  it("settles the shape before the existing-PR query", () => {
    const run = preflightRun();

    expect(run.indexOf("gh api graphql")).toBeLessThan(run.indexOf("gh pr list"));
  });
});
