import { fetchTrustedComments, isTrustedAuthor, safeSh, sh } from "./common.js";

export interface PullRequestFeedback {
  /** Review summary bodies (the text of each submitted review). */
  readonly summaries: string;
  /** Inline review-thread comments, anchored to file + line. */
  readonly inline: string;
  /** Top-level conversation comments on the PR. */
  readonly conversation: string;
  /** Diff of the branch against main, for orientation. */
  readonly diff: string;
  /** False when there is nothing trusted to act on — the caller should refuse. */
  readonly hasFeedback: boolean;
}

/**
 * Gather the feedback an `implement-pr` run should act on.
 *
 * SECURITY: every source here is world-writable on a public repo — anyone can
 * comment on a PR or submit a review. Unlike the review workflow (which only
 * reads and posts text), this one runs with `contents: write` and pushes, so an
 * injection would steer *committed code*. Each source is therefore filtered
 * through `isTrustedAuthor`: repo collaborators, plus `github-actions[bot]`
 * because that is how our own review agent posts its findings.
 *
 * Read here rather than by the agent so it never needs `gh` (the token is
 * scrubbed from its environment before it starts).
 */
export const fetchPullRequestFeedback = (prNumber: string): PullRequestFeedback => {
  const ghRepo = process.env["GH_REPO"] ?? "";

  const parse = <T>(json: string, fallback: T): T => {
    try {
      return JSON.parse(json || "null") ?? fallback;
    } catch {
      return fallback;
    }
  };

  // 1. Review summaries — the body of each submitted review.
  const reviews = parse<
    { body?: string | null; state?: string; author_association?: string; user?: { login?: string } }[]
  >(safeSh(`gh api repos/${ghRepo}/pulls/${prNumber}/reviews`), []);
  const summaries = reviews
    .filter((r) => isTrustedAuthor(r.author_association, r.user?.login))
    .filter((r) => (r.body ?? "").trim().length > 0)
    .map((r) => `**@${r.user?.login ?? "unknown"}** (${r.state ?? "COMMENTED"}):\n${(r.body ?? "").trim()}`)
    .join("\n\n---\n\n");

  // 2. Inline review-thread comments, anchored to a file and line. The REST
  //    endpoint does not expose thread resolution; that (and replying) belongs
  //    to the full workflow. Here they are read-only context.
  const comments = parse<
    {
      body?: string;
      path?: string;
      line?: number | null;
      original_line?: number | null;
      author_association?: string;
      user?: { login?: string };
    }[]
  >(safeSh(`gh api repos/${ghRepo}/pulls/${prNumber}/comments`), []);
  const inline = comments
    .filter((c) => isTrustedAuthor(c.author_association, c.user?.login))
    .filter((c) => (c.body ?? "").trim().length > 0)
    .map((c) => {
      const where = `${c.path ?? "unknown"}:${c.line ?? c.original_line ?? "?"}`;
      return `**${where}** (@${c.user?.login ?? "unknown"}):\n${(c.body ?? "").trim()}`;
    })
    .join("\n\n---\n\n");

  // 3. Top-level conversation comments (the `issues/{n}/comments` endpoint
  //    serves PRs too) — already collaborator-filtered.
  const conversation = fetchTrustedComments(prNumber);

  return {
    summaries,
    inline,
    conversation,
    diff: sh("git diff main...HEAD"),
    hasFeedback: Boolean(summaries || inline || conversation),
  };
};
