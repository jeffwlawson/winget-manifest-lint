import { gh, safeSh, sh } from "./common.js";
import { parseDiffLines } from "./diff-lines.js";

export interface PullRequestContext {
  readonly prTitle: string;
  readonly prBody: string;
  readonly issueNumber: string;
  readonly issueTitle: string;
  readonly linkedIssue: string;
  readonly diff: string;
  readonly diffLines: Map<string, Set<number>>;
}

/**
 * Gather everything the review agent needs, read here rather than by the agent
 * so it has no reason to reach for `gh` itself (see the token-boundary note in
 * implement.ts). This is the *lite* context: PR metadata, the linked issue, and
 * the diff. It deliberately omits the review-thread GraphQL that the full
 * workflow uses to reply to human comments.
 */
export const fetchPullRequestContext = (prNumber: string): PullRequestContext => {
  const prView = JSON.parse(gh(["pr", "view", prNumber, "--json", "title,body"])) as {
    title: string;
    body?: string | null;
  };

  const issueMatch = (prView.body ?? "").match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
  const issueNumber = issueMatch?.[1] ?? "";

  // SECURITY: fetch only the issue title and body, NOT `--comments`. Issue
  // comments on a public repo are world-writable — anyone can post one — and
  // this text is fed verbatim to an unsandboxed agent that holds the model
  // token and posts a public review. World-writable input + secret-bearing
  // agent + public output is a prompt-injection exfiltration path. The title
  // and body require repo write access to author (we create the issues), so
  // restricting to them keeps the injection surface behind the same write-access
  // trust boundary the whole loop already assumes.
  let issueTitle = "";
  let linkedIssue = "(no linked issue found)";
  if (issueNumber) {
    const issueView = JSON.parse(
      safeSh(`gh issue view ${issueNumber} --json title,body`) || "{}",
    ) as { title?: string; body?: string | null };
    issueTitle = issueView.title ?? "";
    linkedIssue = issueView.body?.trim() || "(linked issue has no description)";
  }

  // `main` is fetched as a local ref by the workflow before this runs. Use the
  // three-dot diff (changes since the merge-base) only — no two-dot fallback,
  // which has different semantics and would silently mis-filter inline comments.
  // An empty string here legitimately means "no changes", not an error.
  const diff = sh("git diff main...HEAD");

  return {
    prTitle: prView.title,
    prBody: prView.body ?? "",
    issueNumber,
    issueTitle,
    linkedIssue,
    diff,
    diffLines: parseDiffLines(diff),
  };
};
