/**
 * template-trigger-nudge.tsx tests (#765)
 *
 * Post-create nudge: after creating a loop from a template with a
 * suggestedTriggerSpec, the builder/detail landing offers one-click
 * "Attach suggested trigger: <humanized>" using #762's trigger API. Renders
 * nothing when no suggested-trigger query params are present.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));
mock.module("sonner", () => ({
  toast: { success: () => undefined, error: () => undefined },
}));

const { TemplateTriggerNudge } = await import("./template-trigger-nudge");

describe("TemplateTriggerNudge", () => {
  test("renders nothing when there are no suggested-trigger query params", () => {
    const html = renderToStaticMarkup(
      <TemplateTriggerNudge
        loopId="loop-1"
        searchParams={new URLSearchParams()}
      />,
    );
    expect(html).toBe("");
  });

  test("offers to attach a schedule.cron suggestion with its humanized schedule", () => {
    const params = new URLSearchParams();
    params.set("suggestedTriggerKind", "schedule.cron");
    params.set("suggestedTriggerSchedule", "0 2 * * *");
    const html = renderToStaticMarkup(
      <TemplateTriggerNudge loopId="loop-1" searchParams={params} />,
    );
    expect(html).toContain("Attach suggested trigger");
    expect(html).toContain("Every day at 02:00 UTC");
  });

  test("offers to attach an event-kind suggestion with its humanized kind label", () => {
    const params = new URLSearchParams();
    params.set("suggestedTriggerKind", "github.pull_request");
    const html = renderToStaticMarkup(
      <TemplateTriggerNudge loopId="loop-1" searchParams={params} />,
    );
    expect(html).toContain("Attach suggested trigger");
    expect(html).toContain("Pull request");
  });

  test("renders nothing for an unrecognized suggested-trigger kind", () => {
    const params = new URLSearchParams();
    params.set("suggestedTriggerKind", "webhook.error");
    const html = renderToStaticMarkup(
      <TemplateTriggerNudge loopId="loop-1" searchParams={params} />,
    );
    expect(html).toBe("");
  });
});
