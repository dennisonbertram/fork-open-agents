import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalButtons } from "./approval-buttons";

describe("ApprovalButtons", () => {
  test("renders the session-wide auto-approve action when a handler is provided", () => {
    const html = renderToStaticMarkup(
      <ApprovalButtons
        approvalId="approval-1"
        onApprove={() => {}}
        onDeny={() => {}}
        onApproveAllForSession={() => {}}
      />,
    );

    expect(html).toContain("Approve");
    expect(html).toContain("Deny");
    expect(html).toContain("Allow all this session");
    expect(html).toContain("Allow all tool calls for this session");
  });

  test("does not render session-wide auto-approve when no handler is provided", () => {
    const html = renderToStaticMarkup(
      <ApprovalButtons
        approvalId="approval-1"
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    );

    expect(html).not.toContain("Allow all this session");
  });
});
