import { describe, expect, test } from "bun:test";
import {
  canonicalBackgroundAutomationDetailUrl,
  canonicalBackgroundAutomationEditUrl,
  canonicalLoopAutomationDetailUrl,
  canonicalLoopAutomationEditUrl,
  canonicalNewAutomationUrl,
  canonicalNewLoopAutomationUrl,
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

  test("source-qualifies and safely encodes agent-loop definition ids", () => {
    expect(canonicalLoopAutomationDetailUrl("loop/id ?#")).toBe(
      "/automations/agent-loop/loop%2Fid%20%3F%23",
    );
    expect(canonicalLoopAutomationEditUrl("loop/id ?#")).toBe(
      "/automations/agent-loop/loop%2Fid%20%3F%23/edit",
    );
  });

  test("keeps repository context explicit and encoded on canonical create", () => {
    expect(canonicalNewAutomationUrl()).toBe("/automations/new");
    expect(
      canonicalNewAutomationUrl({ owner: "Acme Org", name: "widgets/api" }),
    ).toBe("/automations/new?repoOwner=Acme+Org&repoName=widgets%2Fapi");
  });

  test("keeps repository context explicit on canonical multi-step create", () => {
    expect(canonicalNewLoopAutomationUrl()).toBe(
      "/automations/agent-loop/new",
    );
    expect(
      canonicalNewLoopAutomationUrl({
        owner: "Acme Org",
        name: "widgets/api",
      }),
    ).toBe(
      "/automations/agent-loop/new?repoOwner=Acme+Org&repoName=widgets%2Fapi",
    );
  });
});
