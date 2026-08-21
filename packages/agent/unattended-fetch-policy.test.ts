import { describe, expect, test } from "bun:test";
import { webFetchTool } from "./tools/fetch";

async function needsApprovalResult(
  input: {
    url: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  },
  experimental_context: unknown,
) {
  const { needsApproval } = webFetchTool;
  if (typeof needsApproval !== "function") {
    return needsApproval ?? false;
  }
  return await Promise.resolve(
    needsApproval(
      input as never,
      {
        toolCallId: "tool-call-1",
        messages: [],
        experimental_context,
      } as never,
    ),
  );
}

describe("web_fetch unattended mutating-method approval (#1394)", () => {
  test("unattended GET auto-approves", async () => {
    expect(
      await needsApprovalResult(
        { url: "https://example.com", method: "GET" },
        { unattended: true },
      ),
    ).toBe(false);
  });

  test("unattended HEAD auto-approves", async () => {
    expect(
      await needsApprovalResult(
        { url: "https://example.com", method: "HEAD" },
        { unattended: true },
      ),
    ).toBe(false);
  });

  test("unattended POST requires approval", async () => {
    expect(
      await needsApprovalResult(
        { url: "https://example.com", method: "POST" },
        { unattended: true },
      ),
    ).toBe(true);
  });

  test("unattended PUT/PATCH/DELETE require approval", async () => {
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      expect(
        await needsApprovalResult(
          { url: "https://example.com", method },
          { unattended: true },
        ),
      ).toBe(true);
    }
  });

  test("attended GET still requires approval", async () => {
    expect(
      await needsApprovalResult(
        { url: "https://example.com", method: "GET" },
        {},
      ),
    ).toBe(true);
  });
});
