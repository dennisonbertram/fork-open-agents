import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("sonner", () => ({
  toast: {
    success: () => undefined,
    error: () => undefined,
  },
}));

const componentModulePromise = import("./calls-client");

describe("GtmCallsClient", () => {
  test("renders prep and debrief inputs", async () => {
    const { GtmCallsClient } = await componentModulePromise;

    const html = renderToStaticMarkup(<GtmCallsClient />);

    expect(html).toContain("Founder objective");
    expect(html).toContain("Notes or transcript");
    expect(html).toContain("Create debrief");
  });

  test("renders a call prep brief", async () => {
    const { CallPrepResult } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <CallPrepResult
        result={{
          callId: "call-1",
          runId: "run-1",
          brief: {
            objective: "Qualify pilot urgency.",
            conciseBrief: "The account is evaluating agent workflows.",
            risks: ["Unresolved: security review"],
            openLoops: ["security review"],
            suggestedQuestions: ["What would block rollout?"],
            desiredOutcome: "Schedule technical review.",
            sourceCount: 1,
          },
        }}
      />,
    );

    expect(html).toContain("Qualify pilot urgency");
    expect(html).toContain("security review");
    expect(html).toContain("What would block rollout?");
  });

  test("renders a call debrief with pending approvals", async () => {
    const { CallDebriefResult } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <CallDebriefResult
        result={{
          callId: "call-2",
          runId: "run-2",
          insightIds: ["insight-1"],
          approvalIds: ["approval-1", "approval-2"],
          debrief: {
            summary: "Jordan is excited but security review is a risk.",
            sentiment: "positive",
            attendees: ["Jordan Lee"],
            nextSteps: [
              {
                summary: "Send pilot plan.",
                owner: "founder",
              },
            ],
            objections: ["security review is a risk"],
            productAsks: ["GitHub App install status should be clearer"],
            followUpDraft: {
              subject: "Follow-up and next steps",
              bodyPreview: "Thanks for the conversation.",
            },
            proposedActions: [
              {
                actionKind: "follow_up_draft",
                summary: "Create follow-up draft.",
                targetKind: "touchpoint",
              },
              {
                actionKind: "gtm_record_update",
                summary: "Apply approved GTM signals.",
                targetKind: "account",
              },
            ],
          },
        }}
      />,
    );

    expect(html).toContain("Jordan is excited");
    expect(html).toContain("Send pilot plan");
    expect(html).toContain("pending approval");
    expect(html).toContain("approval-1");
    expect(html).toContain("Approve");
    expect(html).toContain("Deny");
    expect(html).toContain("GitHub App install status");
  });
});
