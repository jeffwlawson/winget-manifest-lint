import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { claudeAgent, fail, fetchTrustedIssue, required, scrubGitHubTokens, sh } from "../shared/common.js";

const ISSUE_NUMBER = required("ISSUE_NUMBER");
const ISSUE_TITLE = required("ISSUE_TITLE");
const BRANCH = required("BRANCH");

try {
  // Read the issue here and pass it in, rather than letting the agent shell out
  // to `gh`. SECURITY: use the author-gated fetch and never `--comments` — issue
  // comments are world-writable on a public repo, so feeding them to the
  // unsandboxed agent is a prompt-injection path. If the issue author lacks
  // write access, its body is withheld entirely.
  const issue = fetchTrustedIssue(ISSUE_NUMBER);
  const issueContext = issue.trusted
    ? `# ${issue.title || ISSUE_TITLE}\n\n${issue.body || "(no description)"}`
    : `Issue #${ISSUE_NUMBER}: ${ISSUE_TITLE}\n\n(Issue body withheld: the issue author is not a repo collaborator.)`;

  // Context fetched; the agent has no legitimate use for the GitHub token.
  scrubGitHubTokens();

  const result = await sandcastle.run({
    name: `implement-#${ISSUE_NUMBER}`,
    agent: claudeAgent(),
    // The ephemeral Actions runner IS the isolation. Running the agent directly
    // on it means the agent's environment and CI's environment are identical by
    // construction — no image drift, no "works in the sandbox, fails in CI".
    sandbox: noSandbox(),
    logging: { type: "stdout" },
    promptFile: path.join(import.meta.dirname, "prompt.md"),
    promptArgs: {
      ISSUE_NUMBER,
      ISSUE_TITLE,
      BRANCH,
      ISSUE_CONTEXT: issueContext,
    },
    maxIterations: 1,
  });

  const commitsAhead = Number(sh("git rev-list --count main..HEAD").trim());
  if (!Number.isFinite(commitsAhead) || commitsAhead === 0) {
    fail("Agent finished but no commits were made on the branch.");
  }

  console.log(`Implementation produced ${commitsAhead} commit(s) on ${BRANCH}.`);
  console.log(`Commits this run: ${result.commits.length}.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
