import { describe, expect, test } from "bun:test";
import {
  canonicalBackgroundAutomationDetailUrl,
  canonicalBackgroundAutomationEditUrl,
  canonicalNewAutomationUrl,
} from "./definition-routes";

describe("canonical single-step Automation routes", () => {
  test("source-qualifies and safely encodes background-agent definition ids", () => {
    expect(canonicalBackgroundAutomationDetailUrl("agent/id ?#")).toBe(
      "/automations/background-agent/agent%2Fid%20%3F%23",
    );
    expect(canonicalBackgroundAutomationEditUrl("agent/id ?#")).toBe(
      "/automations/background-agent/agent%2Fid%20%3F%23/edit",
    );
  });

  test("keeps repository context explicit and encoded on canonical create", () => {
    expect(canonicalNewAutomationUrl()).toBe("/automations/new");
    expect(
      canonicalNewAutomationUrl({ owner: "Acme Org", name: "widgets/api" }),
    ).toBe("/automations/new?repoOwner=Acme+Org&repoName=widgets%2Fapi");
  });
});
