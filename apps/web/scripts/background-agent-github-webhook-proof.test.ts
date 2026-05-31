import { describe, expect, test } from "bun:test";
import {
  assertDuplicateDispatch,
  assertFirstDispatch,
  getProofConfig,
  GitHubWebhookProofError,
  signPayload,
} from "./background-agent-github-webhook-proof";

const baseEnv = {
  BACKGROUND_AGENT_GITHUB_PROOF_BASE_URL: "https://open-agents.example",
  GITHUB_WEBHOOK_SECRET: "github-secret",
  BACKGROUND_AGENT_GITHUB_PROOF_REPO_OWNER: "acme",
  BACKGROUND_AGENT_GITHUB_PROOF_REPO_NAME: "widgets",
};

describe("background-agent-github-webhook-proof", () => {
  test("signs payloads with the GitHub webhook signature format", () => {
    expect(signPayload('{"zen":"hello"}', "secret")).toMatch(
      /^sha256=[a-f0-9]{64}$/,
    );
  });

  test("builds a deterministic pull request proof fixture", () => {
    const config = getProofConfig(
      {
        ...baseEnv,
        BACKGROUND_AGENT_GITHUB_PROOF_ID: "proof-1234567890",
        BACKGROUND_AGENT_GITHUB_PROOF_EVENT: "pull_request",
      },
      { uuid: () => "proof-ignored" },
    );

    expect(config.baseUrl.origin).toBe("https://open-agents.example");
    expect(config.event).toBe("pull_request");
    expect(config.webhookSecret).toBe("github-secret");
    expect(config.payload).toMatchObject({
      action: "opened",
      repository: {
        name: "widgets",
        owner: { login: "acme" },
      },
      pull_request: {
        id: 100_001,
        number: 7,
        head: {
          ref: "background-proof-proof-12",
          sha: "proof-proof-123456",
        },
        base: { ref: "main" },
      },
    });
  });

  test("builds issue and deployment fixtures", () => {
    const issueConfig = getProofConfig({
      ...baseEnv,
      BACKGROUND_AGENT_GITHUB_PROOF_EVENT: "issues",
      BACKGROUND_AGENT_GITHUB_PROOF_ISSUE_NUMBER: "44",
    });
    expect(issueConfig.payload).toMatchObject({
      issue: {
        number: 44,
        title: "Background agent issue proof",
      },
    });

    const deploymentConfig = getProofConfig({
      ...baseEnv,
      BACKGROUND_AGENT_GITHUB_PROOF_EVENT: "deployment_status",
      BACKGROUND_AGENT_GITHUB_PROOF_DEPLOYMENT_STATE: "failure",
    });
    expect(deploymentConfig.payload).toMatchObject({
      deployment_status: {
        state: "failure",
      },
    });
  });

  test("fails fast when required proof env is missing", () => {
    expect(() => getProofConfig({})).toThrow(GitHubWebhookProofError);
    expect(() =>
      getProofConfig({
        ...baseEnv,
        BACKGROUND_AGENT_GITHUB_PROOF_EVENT: "push",
      }),
    ).toThrow(GitHubWebhookProofError);
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
        runIds: ["run-2"],
      }),
    ).toThrow(GitHubWebhookProofError);
  });
});
