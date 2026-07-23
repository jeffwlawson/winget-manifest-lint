import { fetchTrustedIssue, gh, sh } from "./common.js";
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

  // SECURITY: `fetchTrustedIssue` returns the title/body only when the issue's
  // author has repo write access, and never fetches comments. On a public repo
  // anyone can open an issue or comment on one, and this text reaches an
  // unsandboxed, token-holding agent that posts public output — so untrusted
  // issue text is a prompt-injection / exfiltration source. Gating on author
  // association (not on field type) keeps this input behind the same
  // write-access boundary the rest of the loop assumes, and holds even once
  // community-authored issues enter the backlog.
  let issueTitle = "";
  let linkedIssue = "(no linked issue found)";
  if (issueNumber) {
    const issue = fetchTrustedIssue(issueNumber);
    if (issue.trusted) {
      issueTitle = issue.title;
      linkedIssue = issue.body || "(linked issue has no description)";
    } else {
      linkedIssue = `(linked issue #${issueNumber} was opened by a non-collaborator; its text is omitted so world-writable input never reaches the agent)`;
    }
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
