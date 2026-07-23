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
  const issueTitle = issueNumber
    ? safeSh(`gh issue view ${issueNumber} --json title --jq .title`).trim()
    : "";
  const linkedIssue = issueNumber
    ? safeSh(`gh issue view ${issueNumber} --comments`)
    : "(no linked issue found)";

  // `main` is fetched as a local ref by the workflow before this runs.
  const diff = safeSh("git diff main...HEAD") || sh("git diff main..HEAD");

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
