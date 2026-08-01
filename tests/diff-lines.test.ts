import { describe, expect, it } from "vitest";
import { parseDiffLines } from "../.sandcastle/agent-workflows/shared/diff-lines.js";

/**
 * `parseDiffLines` builds the allow-list that inline review comments are
 * filtered against. GitHub rejects an *entire* review if one comment anchors
 * outside the diff, so an off-by-one here does not degrade a review — it
 * silently posts nothing. The core is the new-file line counter: added and
 * context lines advance it, removed lines do not, and each `@@` header reloads
 * it from the new-file start.
 *
 * Every diff below is real `git diff` output (generated, then pasted), including
 * its trailing newline — that is what `sh("git diff …")` hands the parser in
 * production. One consequence worth naming up front: because the diff ends in a
 * newline, `diff.split("\n")` yields a trailing empty string, and the parser's
 * blank-context branch (`line === ""`) counts it, adding one line past the last
 * hunk to the diff's final file. The tests below assert the properties each case
 * targets with membership checks rather than exact set equality, so this
 * incidental trailing line does not obscure the behaviour under test — except in
 * the deleted-file case, where it is exactly what makes the documented bug fire.
 */

const linesOf = (diff: string, file: string): Set<number> => {
  const set = parseDiffLines(diff).get(file);
  if (!set) throw new Error(`parseDiffLines produced no entry for ${file}`);
  return set;
};

describe("parseDiffLines — added and context lines", () => {
  // Additions live deep in the file, so the hunk header is `+8`, not `+1`. The
  // added lines must be numbered from that header start, not from 1.
  const midFile = `diff --git a/big.txt b/big.txt
index 0ff3bbb..c6ca7ae 100644
--- a/big.txt
+++ b/big.txt
@@ -8,6 +8,8 @@
 8
 9
 10
+NEWA
+NEWB
 11
 12
 13
`;

  it("numbers added lines from the hunk header's new-file start", () => {
    const lines = linesOf(midFile, "big.txt");
    // Context 8, 9, 10 → then NEWA is 11 and NEWB is 12, counting on from +8.
    expect(lines.has(11)).toBe(true);
    expect(lines.has(12)).toBe(true);
    // Nothing before the hunk's new-file start is in range.
    expect(lines.has(7)).toBe(false);
  });

  it("includes context lines — they are valid comment anchors", () => {
    const lines = linesOf(midFile, "big.txt");
    expect(lines.has(8)).toBe(true);
    expect(lines.has(9)).toBe(true);
    expect(lines.has(10)).toBe(true);
  });
});

describe("parseDiffLines — removed lines", () => {
  // k1 / k2 are context; `removeme` is deleted and `ADDED` inserted in its
  // place. In the new file: k1=1, ADDED=2, k2=3.
  const removal = `diff --git a/rem.txt b/rem.txt
index 07795f6..1450354 100644
--- a/rem.txt
+++ b/rem.txt
@@ -1,3 +1,3 @@
 k1
-removeme
+ADDED
 k2
`;

  it("excludes removed lines and does not advance the counter past them", () => {
    const lines = linesOf(removal, "rem.txt");
    expect(lines.has(1)).toBe(true); // k1
    // ADDED is line 2, NOT 3: the removed `removeme` did not advance the count.
    expect(lines.has(2)).toBe(true);
    // k2 is line 3, NOT 4: still no shift from the removal.
    expect(lines.has(3)).toBe(true);
  });
});

describe("parseDiffLines — multiple hunks in one file", () => {
  // Two hunks. The second's header (`@@ -8,5 +8,5 @@ l7`) is non-contiguous with
  // the first, so line 7 falls between them and belongs to no hunk.
  const twoHunks = `diff --git a/m.txt b/m.txt
index 1b2a1c5..f52caf0 100644
--- a/m.txt
+++ b/m.txt
@@ -1,6 +1,6 @@
 l1
 l2
-l3
+ADDED
 l4
 l5
 l6
@@ -8,5 +8,5 @@ l7
 l8
 l9
 l10
-l11
+CHANGED
 l12
`;

  it("resets the counter at each hunk header instead of running on", () => {
    const lines = linesOf(twoHunks, "m.txt");
    // First hunk: ADDED replaces l3 at line 3, and l4 stays at 4 (no shift).
    expect(lines.has(3)).toBe(true);
    expect(lines.has(4)).toBe(true);
    // Line 7 is between the hunks — never emitted. If the counter had run on
    // from the first hunk rather than reloading from `+8`, 7 would be present.
    expect(lines.has(7)).toBe(false);
    // Second hunk picks up from its header start of 8; CHANGED lands at 11.
    expect(lines.has(8)).toBe(true);
    expect(lines.has(11)).toBe(true);
  });
});

describe("parseDiffLines — multiple files in one diff", () => {
  const twoFiles = `diff --git a/add.txt b/add.txt
index 9405325..f7e12a9 100644
--- a/add.txt
+++ b/add.txt
@@ -1,5 +1,7 @@
 a
 b
 c
+NEW1
+NEW2
 d
 e
diff --git a/rem.txt b/rem.txt
index 07795f6..1450354 100644
--- a/rem.txt
+++ b/rem.txt
@@ -1,3 +1,3 @@
 k1
-removeme
+ADDED
 k2
`;

  it("keeps each file's line set separate", () => {
    const parsed = parseDiffLines(twoFiles);
    expect([...parsed.keys()].sort()).toEqual(["add.txt", "rem.txt"]);

    const add = linesOf(twoFiles, "add.txt");
    expect(add.has(4)).toBe(true); // NEW1
    expect(add.has(5)).toBe(true); // NEW2
    expect(add.has(7)).toBe(true); // context `e`

    const rem = linesOf(twoFiles, "rem.txt");
    // rem.txt only ever spans lines 1–3; add.txt's higher lines are not here.
    expect(rem.has(7)).toBe(false);
  });
});

describe("parseDiffLines — file with no trailing newline", () => {
  // Identical change, once with the `\ No newline at end of file` marker and
  // once without. The marker line starts with `\`, so it is skipped; proving the
  // two diffs yield the same line set shows the marker adds no spurious line.
  const withMarker = `diff --git a/f.txt b/f.txt
index 81d69cd..0bfc124 100644
--- a/f.txt
+++ b/f.txt
@@ -1,2 +1,2 @@
 first
-old
+second
\\ No newline at end of file
`;
  const withoutMarker = `diff --git a/f.txt b/f.txt
index 81d69cd..0bfc124 100644
--- a/f.txt
+++ b/f.txt
@@ -1,2 +1,2 @@
 first
-old
+second
`;

  it("does not count the \\ No newline at end of file marker", () => {
    const marked = linesOf(withMarker, "f.txt");
    expect(marked.has(2)).toBe(true); // the added `second`
    expect([...marked].sort((a, b) => a - b)).toEqual(
      [...linesOf(withoutMarker, "f.txt")].sort((a, b) => a - b),
    );
  });
});

describe("parseDiffLines — deleted file", () => {
  // A modified file followed by a deleted one whose name sorts later. The
  // deletion emits `+++ /dev/null`, which does not match the `+++ b/` prefix the
  // parser keys on, so `currentFile` is never repointed at zzz.txt.
  const withDeletion = `diff --git a/keep.txt b/keep.txt
index 0f7bc76..de98044 100644
--- a/keep.txt
+++ b/keep.txt
@@ -1,2 +1,3 @@
 a
+b
 c
diff --git a/zzz.txt b/zzz.txt
deleted file mode 100644
index b77b4eb..0000000
--- a/zzz.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-x
-y
`;

  it("never makes the deleted file a key of its own", () => {
    expect(parseDiffLines(withDeletion).has("zzz.txt")).toBe(false);
  });

  // DOCUMENTED BUG — behaviour is asserted as-is, NOT fixed here (issue #63 is
  // test-only; `.sandcastle/` code runs from this branch during review, so it
  // must not change). The invariant "no line is attributed to a file that does
  // not own it" is VIOLATED: because `+++ /dev/null` leaves `currentFile` on
  // keep.txt, the deleted file's hunk header (`@@ -1,2 +0,0 @@`) resets the
  // counter to 0, and the diff's trailing empty line is then counted against
  // keep.txt — attributing phantom line 0 to a file whose real range is 1–3.
  // Fixing it (e.g. clearing `currentFile` on `+++ /dev/null`) is a separate
  // issue with its own review.
  it("leaks a phantom line 0 into the previously-named file (documents a bug)", () => {
    const keep = linesOf(withDeletion, "keep.txt");
    expect(keep.has(1)).toBe(true); // the file's real, owned lines
    expect(keep.has(2)).toBe(true);
    expect(keep.has(3)).toBe(true);
    expect(keep.has(0)).toBe(true); // <-- phantom, sourced from the deletion
  });
});
