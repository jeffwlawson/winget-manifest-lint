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
 * Everything committed under `.sandcastle/`, found by walking rather than by
 * listing: the point of the checks below is to hold a *file added later* to the
 * same rule, and a hand-maintained list is precisely what a new prompt would not
 * be added to.
 *
 * `output/` is skipped — it is gitignored scratch written by a local run
 * (`shared/common.ts`'s `outputDir()`), so its contents are neither authored nor
 * shipped.
 */
const filesUnder = (dir: string): readonly string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? entry.name === "output"
          ? []
          : filesUnder(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );

const sandcastleFiles = filesUnder(".sandcastle");

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
  // Same, plus it closes each sub-issue it finishes and re-labels the parent to
  // chain the next one. Note what it still cannot do: create an issue. Closing
  // one the PRD already lists is not filing work, so "an agent that raises work
  // never files it" (docs/parity.md §10) is untouched.
  "agent-implement-prd.yml",
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

/** The two workflows that share the `agent:implement` label (#92). */
const IMPLEMENT = path.join(WORKFLOW_DIR, "agent-implement.yml");
const PRD = path.join(WORKFLOW_DIR, "agent-implement-prd.yml");

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

/** The `run:` script of a step, found by id. */
const runOf = (file: string, id: string): string =>
  stepsOf(file).find((s) => s.id === id)?.run ?? "";

/**
 * The body of a bash function declared in a `run:` block. The parser has
 * already stripped the block scalar's own indent, so a top-level declaration
 * sits at column 0 and its closing brace is the next `}` at that same indent.
 *
 * Used to assert what a *refusal* does versus what a *deferral* does, which is
 * the whole difference between the two implement workflows' idle paths and is
 * invisible to a grep over the step as a whole.
 */
const bashFunctionBody = (run: string, name: string): string => {
  const lines = run.split("\n");
  const open = lines.findIndex((l) => l.trimStart().startsWith(`${name}() {`));

  expect(open).toBeGreaterThanOrEqual(0);
  const indent = indentOf(lines[open] ?? "");
  const close = lines.findIndex(
    (l, i) => i > open && l.trimStart() === "}" && indentOf(l) === indent,
  );

  expect(close).toBeGreaterThan(open);
  return lines.slice(open + 1, close).join("\n");
};

/** The body of an `if [ <condition> ]; then … fi` arm, up to its own `fi`. */
const armOf = (run: string, condition: string): string => {
  const start = run.indexOf(condition);

  expect(start).toBeGreaterThanOrEqual(0);
  const end = run.indexOf("\nfi", start);

  expect(end).toBeGreaterThan(start);
  return run.slice(start, end);
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
 * - **`wayfinder:*`** — maps and decision tickets are planning artifacts. They
 *   describe work; they are not work.
 *
 * Both are refused in the preflight step, which is what keeps them job-level
 * rather than agent-level: no checkout, no `npm ci`, no `agent:in-progress`.
 *
 * The third shape — **has sub-issues** — was refused too until #92, and is now
 * handed to `agent-implement-prd` instead. See the partition describe below.
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
   * Two refusals, two messages. A human reading only the comment has to be able
   * to tell which shape they hit — the remedy differs for each, and "refused"
   * alone sends them to the run log.
   */
  it.each([
    ["a sub-issue", "sub-issue of"],
    ["a wayfinder ticket", "planning artifact"],
  ])("refuses %s with its own message", (_shape: string, phrase: string) => {
    expect(preflightRun()).toContain(phrase);
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

/**
 * `agent-implement-prd` (#92) is triggered by the **same label on the same
 * event** as `agent-implement`, so both jobs start on every `agent:implement`
 * label event and the pair has to partition the work between them. The key is
 * the sub-issue count: an issue that has sub-issues belongs to the PRD path,
 * every other shape to `agent-implement`.
 *
 * The property worth encoding is not which one runs — it is that **exactly one
 * of them speaks**. Whichever does not own the shape has to step aside touching
 * nothing at all:
 *
 * - no comment, or a human sees two bot comments about one event, saying
 *   opposite things ("refused, the PRD path is not built" beside a run that is
 *   building it);
 * - no label edit, and this is the load-bearing half — the chain re-adds
 *   `agent:implement` to the parent to start the next slice, and a second job
 *   racing to *remove* it eats the chain silently.
 *
 * That is what `defer` is, in both preflights: a bare `exit 0` with a log line.
 */
describe("the two implement workflows partition issue shapes", () => {
  const preflight = (file: string): string => stepsOf(file)[0]?.run ?? "";

  it.each([IMPLEMENT, PRD])("%s: is triggered by agent:implement on an issue", (file) => {
    const text = fs.readFileSync(file, "utf8");

    expect(text).toContain("issues:\n    types: [labeled]");
    expect(text).toContain("if: github.event.label.name == 'agent:implement'");
  });

  /**
   * A deferral that comments is a second voice; a deferral that edits a label
   * is a race with the other job. Asserted on the function body rather than the
   * step, because the same step legitimately does both when it *refuses*.
   */
  it.each([IMPLEMENT, PRD])("%s: defers without commenting or touching a label", (file) => {
    const body = bashFunctionBody(preflight(file), "defer");

    expect(body).toContain('echo "refused=true"');
    expect(body).not.toContain("gh ");
  });

  /** The other half of the contract: a refusal *does* speak, and consumes the label. */
  it.each([IMPLEMENT, PRD])("%s: refuses by commenting and consuming the label", (file) => {
    const body = bashFunctionBody(preflight(file), "refuse");

    expect(body).toContain("gh issue comment");
    expect(body).toContain('--remove-label "agent:implement"');
  });

  it("agent-implement hands every sub-issue-bearing issue to the PRD path", () => {
    const arm = armOf(preflight(IMPLEMENT), '"$shape" = "has-sub-issues"');

    expect(arm).toContain("defer ");
    expect(arm).not.toContain("refuse");
  });

  it("agent-implement-prd hands back anything without sub-issues", () => {
    const arm = armOf(preflight(PRD), '"$subs" -eq 0');

    expect(arm).toContain("defer ");
    expect(arm).not.toContain("refuse");
  });

  /**
   * The partition has to be settled before *either* workflow says anything,
   * including about a closed issue — otherwise a closed PRD parent collects the
   * same "this issue is not open" comment twice, from two runs, seconds apart.
   * So the shape query moved above the state check in `agent-implement` (it had
   * been first since #102, when nothing else claimed the label).
   */
  it.each([IMPLEMENT, PRD])("%s: settles the partition before the state check", (file) => {
    const run = preflight(file);

    expect(run.indexOf("gh api graphql")).toBeLessThan(run.indexOf('defer "'));
    expect(run.indexOf('defer "')).toBeLessThan(run.indexOf('"$ISSUE_STATE" != "open"'));
  });

  /**
   * Sub-issues *of a PRD* are refused by `agent-implement` and deferred by the
   * PRD path; a nested PRD — sub-issues **and** a parent — is the other way
   * round, since the PRD path is the one that can explain what is wrong with
   * it. Keyed on the shape computation testing the sub-issue count before the
   * parent, which is what routes the overlap.
   */
  it("routes a nested PRD to the PRD path, not to agent-implement", () => {
    const run = preflight(IMPLEMENT);

    expect(run.indexOf('subs" -gt 0')).toBeLessThan(run.indexOf('parent" ]'));
    expect(preflight(PRD)).toContain("nested");
  });
});

/**
 * The PRD chain itself. One sub-issue per run, in sub-issues API order,
 * accumulating onto one branch and one PR, chaining to the next run by
 * re-labelling the parent, and asking for review exactly once at the end.
 *
 * **Ordering comes from creation order, not from the edges.** The chain walks
 * sub-issue API order and never reads `blocked-by`; that is safe only because
 * sub-issues are *created* blockers-first, so the topological sort happens once,
 * at publish time. Do not add edge-reading here — fix the publish order.
 */
describe("agent-implement-prd works one sub-issue per run", () => {
  const NOT_REFUSED = "steps.preflight.outputs.refused == 'false'";
  const PRD_GROUP = "agent-implement-prd-issue-${{ github.event.issue.number }}";

  /**
   * Per *parent issue*, first-come. Not the per-PR group the three PR workflows
   * share: an `issues` event carries no PR number, so the two cannot compute a
   * common key. That residual is recorded in docs/parity.md §10 rather than
   * papered over here.
   */
  it("serialises the chain on the parent issue", () => {
    const { concurrency } = jobOf(PRD);

    expect(concurrency?.group).toBe(PRD_GROUP);
    expect(concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("declares exactly one group", () => {
    const groups = [...fs.readFileSync(PRD, "utf8").matchAll(/^\s*group:\s*(.+)$/gm)].map((m) =>
      (m[1] ?? "").trim(),
    );

    expect(groups).toEqual([PRD_GROUP]);
  });

  it("guards first, and the guard is itself ungated", () => {
    const first = stepsOf(PRD)[0];

    expect(first?.id).toBe("preflight");
    expect(first?.if).toBeUndefined();
  });

  /** One query for parent, labels and the sub-issue list together — see #90. */
  it("computes the shape once, from a single API call", () => {
    const run = runOf(PRD, "preflight");

    expect([...run.matchAll(/gh api graphql/g)]).toHaveLength(1);
    expect(run).toContain("parent {");
    expect(run).toContain("subIssues(");
    expect(run).toContain("nodes { number title state }");
  });

  /**
   * The whole scheduling policy, in one jq filter: keep the OPEN ones in the
   * order the API returned them, take the head. No sort, no edge read.
   */
  it("targets the first still-open sub-issue in API order", () => {
    const run = runOf(PRD, "preflight");

    expect(run).toContain('select(.state == "OPEN")');
    expect(run).toContain("| .[0]");
    expect(run).toContain("sub=");
  });

  /**
   * Three refusals, three messages, and each one names a different thing to do
   * about it. `agent:blocked` on the two durable shapes only: a PRD whose
   * sub-issues have all closed is *finished*, and labelling a completed parent
   * blocked leaves exactly the stale label docs/parity.md §10 warns about.
   */
  it.each([
    ["a nested PRD", "nested"],
    ["a wayfinder ticket", "planning artifact"],
    ["a PRD with nothing left to do", "closed"],
  ])("refuses %s with its own message", (_case: string, phrase: string) => {
    expect(runOf(PRD, "preflight")).toContain(phrase);
  });

  /**
   * `totalCount` is unpaged and `nodes` is not, so past the page size the head
   * of the open list can sit off the end of the page — and "no open sub-issue"
   * is read as *finished*. Refusing loudly beats closing a PRD that has work
   * left in it.
   */
  it("refuses rather than silently reading a truncated sub-issue list", () => {
    const run = runOf(PRD, "preflight");

    expect(run).toContain("subIssues(first: 100)");
    expect(armOf(run, '"$subs" -gt 100')).toContain("refuse_shape");
    expect(run.indexOf('"$subs" -gt 100')).toBeLessThan(run.indexOf("no open sub-issues"));
  });

  it("marks the durable shape refusals blocked, and the finished PRD not", () => {
    const run = runOf(PRD, "preflight");

    expect(bashFunctionBody(run, "refuse_shape")).toContain('--add-label "agent:blocked"');
    expect(armOf(run, "no open sub-issues")).not.toContain("refuse_shape");
  });

  /** Same exception as #90: "no answer" must never be read as a shape. */
  it("does not swallow a failed shape query", () => {
    const tolerant = runOf(PRD, "preflight")
      .split("\n")
      .filter((l) => l.includes("|| true") && !l.trimStart().startsWith("#"));

    expect(tolerant).not.toHaveLength(0);
    for (const line of tolerant) expect(line).toContain("gh issue edit");
  });

  it.each([
    ["checks nothing out", (s: Step) => (s.uses ?? "").startsWith("actions/checkout@")],
    [
      "installs nothing",
      (s: Step) => (s.run ?? "").includes("npm ci") || (s.uses ?? "").startsWith("actions/setup-node@"),
    ],
    ["never enters agent:in-progress", (s: Step) => (s.run ?? "").includes('--add-label "agent:in-progress"')],
  ])("%s when it refuses or defers", (_case: string, match: (s: Step) => boolean) => {
    const steps = stepsOf(PRD).filter(match);

    expect(steps).not.toHaveLength(0);
    for (const step of steps) expect(step.if ?? "").toContain(NOT_REFUSED);
  });

  /**
   * The branch is the unit of accumulation, so it is created once and reused —
   * looked up on the remote first, and only branched from the base when it is
   * genuinely absent.
   */
  it("reuses one branch across the chain", () => {
    const branch = runOf(PRD, "branch");
    const prepare = runOf(PRD, "prepare");

    expect(branch).toContain("git ls-remote");
    expect(branch).toContain("agent/prd-${ISSUE_NUMBER}-${slug}");
    expect(branch).toContain('name="$existing"');
    expect(prepare.indexOf('"$EXISTS" = "true"')).toBeLessThan(prepare.indexOf("git checkout -b"));
  });

  /**
   * The lookup is keyed on the **issue number**, not on the whole computed
   * name. A branch name is `agent/prd-<n>-<slug>` and the slug comes from the
   * parent's *title*, which a human may edit at any point; the number is the
   * half nobody can. Recomputing the whole name every run means a retitle
   * mid-chain misses the branch carrying slices 1..N-1, forks slice N off
   * `main`, and opens a second draft PR with the same `Closes #<parent>` — the
   * "created once and reused" property broken by an edit nobody would think of
   * as dangerous. So the slug may only ever *name* a branch, never find one.
   */
  it("finds the branch by the half of its name a human cannot edit", () => {
    const run = runOf(PRD, "branch");

    expect(run).toContain('git ls-remote --heads origin "agent/prd-${ISSUE_NUMBER}-*"');
    expect(run.indexOf("git ls-remote")).toBeLessThan(run.indexOf("${slug}"));
  });

  /**
   * **Plain `git push`.** `agent-implement` force-pushes because it owns a
   * branch it created this run; here the branch carries every earlier slice, so
   * a force push is a chain that silently eats its own history. A rejected
   * non-fast-forward is the correct outcome instead.
   */
  it("pushes without force", () => {
    const text = fs.readFileSync(PRD, "utf8");

    expect(text).toContain('git push origin "$BRANCH"');
    expect(text).not.toMatch(/git push[^\n]*--force/);
  });

  /** The PR is opened once and reused, the same way the branch is. */
  it("reuses one PR across the chain", () => {
    const run = runOf(PRD, "pr");

    expect(run).toContain('gh pr list --head "$BRANCH"');
    expect(run.indexOf("gh pr list")).toBeLessThan(run.indexOf("gh pr create"));
    // Draft until review says otherwise: a PR mid-chain is precisely a pipeline
    // that has not finished (docs/parity.md §10).
    expect(run).toContain("gh pr create --draft");
  });

  it("closes the finished sub-issue with a comment naming the commit", () => {
    const close = stepsOf(PRD).find((s) => (s.run ?? "").includes("gh issue close"));

    expect(close?.if ?? "").toContain(NOT_REFUSED);
    expect(close?.if ?? "").toContain("success()");
    expect(close?.run ?? "").toContain("git rev-parse HEAD");
    expect(close?.run ?? "").toContain("--comment");
  });

  /**
   * Chain or hand off, never both, and gated on a **re-read** count rather than
   * on the preflight's snapshot minus one — a sub-issue may have been added or
   * closed by hand while the agent was running.
   */
  it("chains while sub-issues remain and requests review when none do", () => {
    const chain = stepsOf(PRD).find((s) => (s.run ?? "").includes('--add-label "agent:implement"'));
    const review = stepsOf(PRD).find((s) => (s.run ?? "").includes('--add-label "agent:review"'));

    expect(runOf(PRD, "remaining")).toContain("gh api graphql");
    expect(chain?.if ?? "").toContain("steps.remaining.outputs.count != '0'");
    expect(review?.if ?? "").toContain("steps.remaining.outputs.count == '0'");
    expect(chain?.run ?? "").toContain('gh issue edit "$ISSUE_NUMBER"');
  });

  /**
   * Both label adds are silent no-ops under `GITHUB_TOKEN` — the anti-recursion
   * rule (docs/ADOPTING.md §1). For the chain that is worse than for review: the
   * label appears on the parent and the next slice simply never happens, which
   * reads as "still working" forever.
   */
  it.each(['--add-label "agent:implement"', '--add-label "agent:review"'])(
    "warns loudly when AGENT_PAT is absent for `%s`",
    (adds: string) => {
      const step = stepsOf(PRD).find((s) => (s.run ?? "").includes(adds));

      expect(step?.env?.["GH_TOKEN"]).toBe("${{ secrets.AGENT_PAT || secrets.GITHUB_TOKEN }}");
      expect(step?.env?.["HAS_PAT"]).toBe("${{ secrets.AGENT_PAT != '' }}");
      expect(step?.run ?? "").toContain("::warning::");
    },
  );

  /**
   * …and fails when the add itself fails, which is a different thing and needs
   * `-e` to hold. Both steps end with that warn-if-no-PAT `if`, which returns 0
   * whenever the PAT *is* set — and it is the last command, so without `-e` a
   * failed `gh ... --add-label` exits the step green. `Mark blocked on failure`
   * is gated on `failure()` and would never fire: the chain halts on a green
   * run with no agent label left on the parent, or the PR sits finished and in
   * draft with nobody asked to review it.
   */
  it.each(['--add-label "agent:implement"', '--add-label "agent:review"'])(
    "fails the run rather than swallowing a failed `%s`",
    (adds: string) => {
      const step = stepsOf(PRD).find((s) => (s.run ?? "").includes(adds));

      expect(step?.run ?? "").toContain("set -euo pipefail");
    },
  );

  /**
   * Every step after `Close the finished sub-issue` fails with that sub-issue
   * *already closed*, so on the last slice the failure comment's own remedy —
   * re-apply `agent:implement` — lands on the finished-PRD refusal instead of
   * retrying anything. Both ends of that loop therefore have to name the other
   * way in: the PR, still open and in draft, wanting `agent:review` by hand.
   * Otherwise it is the remedy-that-refuses-again trap agent-implement.yml
   * warns about, with no exit at all.
   */
  it("names the draft PR as the way out when the chain dies after its last close", () => {
    const failed = stepsOf(PRD).find((s) => (s.run ?? "").includes("failure_reason.txt"));

    expect(failed?.env?.["PR_NUMBER"]).toBe("${{ steps.pr.outputs.number }}");
    expect(failed?.run ?? "").toContain("agent:review");
    expect(armOf(runOf(PRD, "preflight"), "no open sub-issues")).toContain("agent:review");
  });

  /** Same `!= 'true'` gate as #90: a preflight that *dies* writes no output. */
  it("comments on a preflight that fails rather than refuses", () => {
    const blocked = stepsOf(PRD).find((s) => (s.run ?? "").includes("failure_reason.txt"));

    expect(blocked?.if ?? "").toContain("steps.preflight.outputs.refused != 'true'");
    expect(blocked?.if ?? "").toContain("failure()");
    expect(blocked?.run ?? "").toContain('--add-label "agent:blocked"');
  });

  it("removes agent:in-progress however the run ends", () => {
    const last = stepsOf(PRD).at(-1);

    expect(last?.if ?? "").toContain("always()");
    expect(last?.run ?? "").toContain('--remove-label "agent:in-progress"');
  });
});

/**
 * The runner contract, held to by every workflow in the set: fetch the context
 * before the agent starts, scrub the token, and leave every tracker mutation to
 * the workflow. `implement-prd` is the first runner handed *two* issues — the
 * PRD for context and the sub-issue for the task — so both go through the same
 * author gate.
 */
describe("the implement-prd runner keeps the agent off the tracker", () => {
  const RUNNER = ".sandcastle/agent-workflows/implement-prd/implement-prd.ts";
  const PROMPT = ".sandcastle/agent-workflows/implement-prd/prompt.md";

  it("author-gates both issues and scrubs the token before running", () => {
    const text = fs.readFileSync(RUNNER, "utf8");

    // Every issue this runner reads goes through the trusted helpers — nothing
    // shells out to `gh` for text. An ungated *PRD* body steers the agent just
    // as effectively as an ungated sub-issue body, so both are named here.
    expect(text).toContain("fetchTrustedIssue(");
    expect(text).toContain("fetchTrustedComments(");
    expect(text).not.toMatch(/safeSh\(|\bsh\(`gh /);
    for (const source of ["ISSUE_NUMBER", "SUB_NUMBER"]) {
      expect(text).toMatch(new RegExp(`issueSection\\(${source}`));
    }
    expect(text.indexOf("scrubGitHubTokens()")).toBeLessThan(text.indexOf("sandcastle.run"));
  });

  /**
   * Counting commits against `main` would count every earlier slice, so a run
   * where the agent did nothing at all would still look productive from the
   * second slice on. The tip at entry is the only honest baseline.
   */
  it("measures this run's commits from the branch tip, not from main", () => {
    const text = fs.readFileSync(RUNNER, "utf8");

    expect(text).not.toContain("main..HEAD");
    expect(text).toContain("rev-list");
  });

  it("tells the agent to implement one sub-issue and touch no tracker state", () => {
    const prompt = fs.readFileSync(PROMPT, "utf8");

    expect(prompt).toContain("{{SUB_NUMBER}}");
    expect(prompt).toContain("{{BRANCH}}");
    expect(prompt).toMatch(/Do not push\./);
    expect(prompt).toMatch(/Do not close/);
  });
});

/**
 * `.sandcastle/` is the agent loop, and the loop is the deliverable (#88) — it
 * ships to other repos rather than living in this one. So nothing in it may name
 * this repo's domain, and nothing in it may name this repo's toolchain.
 *
 * The seam that replaces both already exists and is load-bearing: every prompt
 * reads `CONTEXT.md` and `CLAUDE.md` first, so what is specific to a repo lives
 * with the adopter rather than with the template. The prompts point at those two
 * files; the files answer.
 *
 * These are deliberately mechanical. De-domaining is a one-off edit anyone can
 * do; *staying* de-domained is a habit, and the next prompt written under
 * deadline will be written by someone who has this repo's vocabulary in their
 * head and no reason to suspect it. A grep is what catches that; a review is
 * what misses it.
 */
describe(".sandcastle names no repo of its own", () => {
  it("finds files to check", () => {
    expect(sandcastleFiles.length).toBeGreaterThan(0);
  });

  /**
   * The four terms are this repo's domain vocabulary as it actually leaked (#95):
   * the product name, the field that is the whole role-vs-`ManifestType`
   * distinction, the directory rules are registered in, and the constructor a
   * rule is defined with.
   *
   * `.ts` files are in scope too, not only prompts — `shared/common.ts` carried
   * the repo name as a Standard Schema `vendor`, which is exactly the kind of
   * site a prompt-focused pass reads straight past.
   */
  const DOMAIN = /winget|ManifestType|src\/rules|defineRule/;

  it.each(sandcastleFiles)("%s: names nothing specific to this project", (file: string) => {
    const offenders = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => DOMAIN.test(line))
      .map(({ line, n }) => `${file}:${n} ${line.trim()}`);

    expect(offenders).toEqual([]);
  });

  /**
   * The gate command is the other half. It cannot become a `{{…}}` argument:
   * `runWithExtraction` drops `promptArgs` before the extraction run, so
   * `update-branch/extraction.md` — whose output *is* the comment posted to the
   * PR — would receive one literal, the same trap the base-ref checks above
   * record. The placeholder is therefore the pointer the prompts already carry:
   * `CLAUDE.md` names the command and the prompt names `CLAUDE.md`, which is what
   * `docs/ADOPTING.md` §6 asks an adopter to write down anyway.
   */
  it.each(sandcastleFiles)("%s: points at the gate rather than naming it", (file: string) => {
    expect(fs.readFileSync(file, "utf8")).not.toContain("npm run verify");
  });
});
