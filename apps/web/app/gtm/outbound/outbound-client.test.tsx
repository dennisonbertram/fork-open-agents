import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("sonner", () => ({
  toast: {
    success: () => undefined,
    error: () => undefined,
  },
}));

const componentModulePromise = import("./outbound-client");

describe("GtmOutboundClient", () => {
  test("renders the outbound input surface and empty state", async () => {
    const { GtmOutboundClient } = await componentModulePromise;

    const html = renderToStaticMarkup(<GtmOutboundClient />);

    expect(html).toContain("Recipient domain");
    expect(html).toContain("Body preview");
    expect(html).toContain("No outbound approval selected");
  });

  test("renders pending approval and policy boundary", async () => {
    const { OutboundApprovalResult } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <OutboundApprovalResult
        subject="Following up"
        body="Hi Jordan, should we compare notes?"
        recipientDomain="example.com"
        result={{
          touchpointId: "touchpoint-1",
          approvalId: "approval-1",
          status: "pending_approval",
          policy: {
            actionKind: "email_send",
            requiresApproval: true,
            externalMutationAllowed: false,
            reason: "pending_approval",
            policySnapshot: {
              approvalStatus: "pending",
            },
          },
        }}
      />,
    );

    expect(html).toContain("Local draft created");
    expect(html).toContain("touchpoint-1");
    expect(html).toContain("approval-1");
    expect(html).toContain("Following up");
    expect(html).toContain("external mutation");
    expect(html).toContain("false");
    expect(html).toContain("Approve");
    expect(html).toContain("Deny");
  });
});
