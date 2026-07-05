/**
 * Tests for the stall-escalation state machine (#916): replaces the
 * hard-kill behavior of the no-progress (#914) / action-repetition (#915)
 * budgets with nudge -> escalate -> finalize -> terminate.
 * Intentionally RED before implementation — the module does not exist yet.
 */
import { describe, expect, test } from "bun:test";
import {
  buildReplanNudgeNote,
  buildStallFinalizeInstruction,
  createStallEscalation,
  resolveWrapUpCapability,
} from "./stall-escalation";

describe("createStallEscalation", () => {
  test("first stalled observation nudges", () => {
    const escalation = createStallEscalation({
      graceTurns: 3,
      finalizeTurns: 2,
    });

    const result = escalation.observe({ stalled: true, trigger: "git_stale" });

    expect(result.action).toBe("nudge");
    expect(result.stage).toBe("nudged");
    expect(result.trigger).toBe("git_stale");
  });

  test("continues while nudged and stalled until graceTurns elapse, then escalates", () => {
    const escalation = createStallEscalation({
      graceTurns: 2,
      finalizeTurns: 2,
    });

    const first = escalation.observe({ stalled: true, trigger: "git_stale" });
    expect(first.action).toBe("nudge");

    const second = escalation.observe({ stalled: true, trigger: "git_stale" });
    expect(second.action).toBe("continue");

    const third = escalation.observe({ stalled: true, trigger: "git_stale" });
    expect(third.action).toBe("escalate");
    expect(third.stage).toBe("escalating");
    expect(third.trigger).toBe("git_stale");
  });

  test("after escalate, finalizeTurns observes produce finalize then terminate", () => {
    const escalation = createStallEscalation({
      graceTurns: 1,
      finalizeTurns: 3,
    });

    // Turn 1: nudge. Turn 2: grace elapsed (graceTurns=1) -> escalate.
    escalation.observe({ stalled: true, trigger: "repetition" });
    const escalated = escalation.observe({
      stalled: true,
      trigger: "repetition",
    });
    expect(escalated.action).toBe("escalate");

    const finalize1 = escalation.observe({ stalled: true, trigger: null });
    const finalize2 = escalation.observe({ stalled: true, trigger: null });
    const terminated = escalation.observe({ stalled: true, trigger: null });

    expect(finalize1.action).toBe("finalize");
    expect(finalize2.action).toBe("finalize");
    expect(terminated.action).toBe("terminate");
    expect(terminated.trigger).toBe("repetition");
  });

  test("recovers from nudged back to running when stalled clears", () => {
    const escalation = createStallEscalation({
      graceTurns: 3,
      finalizeTurns: 2,
    });

    escalation.observe({ stalled: true, trigger: "git_stale" });
    const recovered = escalation.observe({ stalled: false, trigger: null });

    expect(recovered.action).toBe("continue");
    expect(recovered.stage).toBe("running");

    // A later stall re-nudges rather than resuming the earlier grace count.
    const renudged = escalation.observe({
      stalled: true,
      trigger: "git_stale",
    });
    expect(renudged.action).toBe("nudge");
  });

  test("escalating ignores the stalled input and counts down regardless", () => {
    const escalation = createStallEscalation({
      graceTurns: 1,
      finalizeTurns: 2,
    });

    escalation.observe({ stalled: true, trigger: "git_stale" });
    const escalated = escalation.observe({
      stalled: true,
      trigger: "git_stale",
    });
    expect(escalated.action).toBe("escalate");

    // Even though stalled flips to false, escalating still counts down.
    const finalize = escalation.observe({ stalled: false, trigger: null });
    expect(finalize.action).toBe("finalize");
    const terminated = escalation.observe({ stalled: false, trigger: null });
    expect(terminated.action).toBe("terminate");
  });
});

describe("buildReplanNudgeNote", () => {
  test("contains re-plan / different-approach language", () => {
    const note = buildReplanNudgeNote();
    expect(note.toLowerCase()).toContain("re-plan");
    expect(note.toLowerCase()).toContain("different approach");
  });
});

describe("buildStallFinalizeInstruction", () => {
  test("push_or_pr capability: commit/push/open + three-part stuck-report", () => {
    const note = buildStallFinalizeInstruction("push_or_pr", "git_stale");
    expect(note.toLowerCase()).toContain("commit and push");
    expect(note.toLowerCase()).toContain("open");
    expect(note).toContain("what you attempted");
    expect(note).toContain("where you got stuck");
    expect(note).toContain("what decision you need");
  });

  test("comment_only capability: post-comment + three-part, no push/pull request", () => {
    const note = buildStallFinalizeInstruction("comment_only", "repetition");
    expect(note.toLowerCase()).not.toContain("push");
    expect(note.toLowerCase()).not.toContain("pull request");
    expect(note).toContain("comment");
    expect(note).toContain("what you attempted");
  });

  test("read_only capability: summary-only, no push/comment tool language", () => {
    const note = buildStallFinalizeInstruction("read_only", "git_stale");
    expect(note.toLowerCase()).not.toContain("push");
    expect(note.toLowerCase()).not.toContain("comment");
    expect(note).toContain("summarize");
  });
});

describe("resolveWrapUpCapability", () => {
  test("push or openPullRequest toggles resolve to push_or_pr", () => {
    expect(
      resolveWrapUpCapability({
        openPullRequest: true,
        push: false,
        commentOnPrOrIssue: false,
      }),
    ).toBe("push_or_pr");
    expect(
      resolveWrapUpCapability({
        openPullRequest: false,
        push: true,
        commentOnPrOrIssue: false,
      }),
    ).toBe("push_or_pr");
  });

  test("comment-only toggle resolves to comment_only", () => {
    expect(
      resolveWrapUpCapability({
        openPullRequest: false,
        push: false,
        commentOnPrOrIssue: true,
      }),
    ).toBe("comment_only");
  });

  test("no write/comment toggles resolve to read_only", () => {
    expect(
      resolveWrapUpCapability({
        openPullRequest: false,
        push: false,
        commentOnPrOrIssue: false,
      }),
    ).toBe("read_only");
  });
});
