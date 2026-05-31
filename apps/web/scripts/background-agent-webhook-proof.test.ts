import { describe, expect, test } from "bun:test";
import {
  assertDuplicateDispatch,
  assertFirstDispatch,
  BackgroundAgentProofError,
  getProofConfig,
  signPayload,
} from "./background-agent-webhook-proof";

describe("background-agent-webhook-proof", () => {
  test("signs payloads with the background webhook signature format", () => {
    expect(signPayload('{"externalId":"err-1"}', "secret")).toMatch(
      /^sha256=[a-f0-9]{64}$/,
    );
  });

  test("builds a deterministic safe payload from environment", () => {
    const config = getProofConfig(
      {
        BACKGROUND_AGENT_PROOF_BASE_URL: "https://open-agents.example",
        BACKGROUND_AGENT_PROOF_WEBHOOK_PUBLIC_ID: "wh_123",
        BACKGROUND_AGENTS_WEBHOOK_SECRET: "webhook-secret",
        BACKGROUND_AGENT_PROOF_EXTERNAL_ID: "err-1",
        BACKGROUND_AGENT_PROOF_REPO_OWNER: "acme",
        BACKGROUND_AGENT_PROOF_REPO_NAME: "widgets",
        BACKGROUND_AGENT_PROOF_DUPLICATE: "false",
      },
      { now: new Date("2026-05-27T12:00:00.000Z") },
    );

    expect(config.baseUrl.origin).toBe("https://open-agents.example");
    expect(config.webhookPublicId).toBe("wh_123");
    expect(config.webhookSecret).toBe("webhook-secret");
    expect(config.sendDuplicate).toBe(false);
    expect(config.payload).toMatchObject({
      externalId: "err-1",
      repoOwner: "acme",
      repoName: "widgets",
      severity: "critical",
      occurredAt: "2026-05-27T12:00:00.000Z",
    });
  });

  test("fails fast when required proof env is missing", () => {
    expect(() => getProofConfig({})).toThrow(BackgroundAgentProofError);
  });

  test("asserts first and duplicate delivery semantics", () => {
    const first = {
      enabled: true,
      matched: 1,
      created: 1,
      duplicates: 0,
      runIds: ["run-1"],
    };
    const duplicate = {
      enabled: true,
      matched: 1,
      created: 0,
      duplicates: 1,
      runIds: ["run-1"],
    };

    expect(() => assertFirstDispatch(first)).not.toThrow();
    expect(() => assertDuplicateDispatch(first, duplicate)).not.toThrow();
    expect(() =>
      assertDuplicateDispatch(first, {
        ...duplicate,
        created: 1,
        duplicates: 0,
      }),
    ).toThrow(BackgroundAgentProofError);
  });
});
