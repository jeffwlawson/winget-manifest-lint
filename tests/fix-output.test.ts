import { describe, expect, it } from "vitest";
import {
  filterOutcomes,
  fixOutputSchema,
  type ThreadOutcome,
} from "../.sandcastle/agent-workflows/shared/fix-output.js";

/**
 * These guard a mutation, not a rule. An outcome naming the wrong thread does
 * not merely produce a bad message — `resolveReviewThread` would close feedback
 * nobody addressed, which is silent and hard to notice.
 */

const parse = (value: unknown) => {
  const result = fixOutputSchema["~standard"].validate(value);
  if ("issues" in result && result.issues) {
    throw new Error(result.issues.map((i) => i.message).join("; "));
  }
  return (result as { value: { threadOutcomes: ThreadOutcome[] } }).value;
};

const outcome = (over: Partial<ThreadOutcome> = {}): ThreadOutcome => ({
  threadId: "PRRT_a",
  status: "addressed",
  reply: "done",
  ...over,
});

describe("fixOutputSchema", () => {
  it("accepts addressed and declined", () => {
    const out = parse({
      threadOutcomes: [
        { threadId: "PRRT_a", status: "addressed", reply: "fixed" },
        { threadId: "PRRT_b", status: "declined", reply: "not a real problem because…" },
      ],
    });
    expect(out.threadOutcomes.map((o) => o.status)).toEqual(["addressed", "declined"]);
  });

  it("rejects a status outside the two allowed values", () => {
    expect(() =>
      parse({ threadOutcomes: [{ threadId: "PRRT_a", status: "resolved", reply: "x" }] }),
    ).toThrow(/must be "addressed" or "declined"/);
  });

  it("accepts snake_case thread_id, since the model emits both", () => {
    const out = parse({
      threadOutcomes: [{ thread_id: "PRRT_a", status: "addressed", reply: "x" }],
    });
    expect(out.threadOutcomes[0]?.threadId).toBe("PRRT_a");
  });

  it("defaults to an empty list rather than failing", () => {
    expect(parse({}).threadOutcomes).toEqual([]);
  });
});

describe("filterOutcomes", () => {
  it("keeps outcomes for threads that were shown", () => {
    expect(filterOutcomes([outcome()], ["PRRT_a"])).toHaveLength(1);
  });

  it("drops an invented thread id rather than resolving something unrelated", () => {
    expect(filterOutcomes([outcome({ threadId: "PRRT_made_up" })], ["PRRT_a"])).toEqual([]);
  });

  it("collapses duplicates so a thread is never replied to twice", () => {
    const kept = filterOutcomes(
      [outcome({ reply: "first" }), outcome({ reply: "second" })],
      ["PRRT_a"],
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.reply).toBe("first");
  });

  it("drops everything when no threads were shown", () => {
    expect(filterOutcomes([outcome()], [])).toEqual([]);
  });
});
