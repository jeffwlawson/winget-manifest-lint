import { describe, expect, it } from "vitest";
import { diffCommandAgainstBase } from "../.sandcastle/agent-workflows/shared/pr-feedback.js";

/**
 * The review's inline-comment allow-list is built from the same diff GitHub uses
 * to define the PR. GitHub diffs against the PR's *base branch* merge-base, so
 * this command must too — diffing against a hardcoded `main` on a stacked PR
 * pulls in the intermediate branch's lines, the allow-list disagrees with
 * GitHub's, and GitHub rejects the entire review silently (issue #71). Only the
 * base is a variable; the seam worth testing is which base is chosen, so these
 * assert the exact command string.
 */
describe("diffCommandAgainstBase", () => {
  it("diffs against the given base, three-dot, HEAD on the right", () => {
    expect(diffCommandAgainstBase("main")).toBe("git diff main...HEAD");
  });

  it("uses the PR's real base on a stacked PR, not a literal main", () => {
    // A PR based on the intermediate branch of a stack. Diffing against `main`
    // here would fold that branch's commits into the allow-list and diff.
    expect(diffCommandAgainstBase("agent/issue-68-stacked")).toBe(
      "git diff agent/issue-68-stacked...HEAD",
    );
  });

  it("keeps the three-dot form — two-dot has different semantics and mis-filters", () => {
    // Exactly three dots between base and HEAD: `<base>...HEAD` is changes since
    // the merge-base, which is what GitHub shows.
    expect(diffCommandAgainstBase("release/1.x")).toBe("git diff release/1.x...HEAD");
  });

  it("falls back to main when the base ref is absent or empty", () => {
    expect(diffCommandAgainstBase(undefined)).toBe("git diff main...HEAD");
    expect(diffCommandAgainstBase("")).toBe("git diff main...HEAD");
    expect(diffCommandAgainstBase("   ")).toBe("git diff main...HEAD");
  });
});
