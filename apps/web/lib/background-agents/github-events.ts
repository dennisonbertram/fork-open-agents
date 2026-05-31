import { z } from "zod";
import type { NormalizedBackgroundTriggerEvent } from "./types";

const repositorySchema = z.object({
  name: z.string(),
  owner: z.object({
    login: z.string(),
  }),
  full_name: z.string().optional(),
});

const senderSchema = z
  .object({
    login: z.string().optional(),
  })
  .optional();

const pullRequestSchema = z.object({
  action: z.string(),
  repository: repositorySchema,
  sender: senderSchema,
  pull_request: z.object({
    id: z.number().optional(),
    number: z.number(),
    title: z.string().optional(),
    html_url: z.string().optional(),
    head: z.object({
      ref: z.string().optional(),
      sha: z.string().optional(),
    }),
    base: z.object({
      ref: z.string().optional(),
    }),
    labels: z
      .array(
        z.object({
          name: z.string(),
        }),
      )
      .optional(),
  }),
});

const issuesSchema = z.object({
  action: z.string(),
  repository: repositorySchema,
  sender: senderSchema,
  issue: z.object({
    id: z.number().optional(),
    number: z.number(),
    title: z.string().optional(),
    html_url: z.string().optional(),
    labels: z
      .array(
        z.object({
          name: z.string(),
        }),
      )
      .optional(),
  }),
});

const deploymentStatusSchema = z.object({
  action: z.string(),
  repository: repositorySchema,
  sender: senderSchema,
  deployment: z.object({
    id: z.number().optional(),
    ref: z.string().optional(),
    sha: z.string().optional(),
    environment: z.string().optional(),
  }),
  deployment_status: z.object({
    id: z.number().optional(),
    state: z.string(),
    target_url: z.string().nullable().optional(),
    environment: z.string().nullable().optional(),
  }),
});

export function normalizeGitHubBackgroundEvent(
  eventName: string,
  payload: unknown,
): NormalizedBackgroundTriggerEvent | null {
  if (eventName === "pull_request") {
    const parsed = pullRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return null;
    }

    const pr = parsed.data.pull_request;
    return {
      source: "github",
      kind: "github.pull_request",
      externalId: `pull_request:${pr.id ?? pr.number}:${parsed.data.action}:${pr.head.sha ?? "unknown"}`,
      repoOwner: parsed.data.repository.owner.login,
      repoName: parsed.data.repository.name,
      action: parsed.data.action,
      ref: pr.head.ref,
      sha: pr.head.sha,
      branch: pr.base.ref,
      prNumber: pr.number,
      labels: pr.labels?.map((label) => label.name) ?? [],
      title: pr.title,
      url: pr.html_url,
      actor: parsed.data.sender?.login,
    };
  }

  if (eventName === "issues") {
    const parsed = issuesSchema.safeParse(payload);
    if (!parsed.success) {
      return null;
    }

    const issue = parsed.data.issue;
    return {
      source: "github",
      kind: "github.issue",
      externalId: `issue:${issue.id ?? issue.number}:${parsed.data.action}`,
      repoOwner: parsed.data.repository.owner.login,
      repoName: parsed.data.repository.name,
      action: parsed.data.action,
      issueNumber: issue.number,
      labels: issue.labels?.map((label) => label.name) ?? [],
      title: issue.title,
      url: issue.html_url,
      actor: parsed.data.sender?.login,
    };
  }

  if (eventName === "deployment_status") {
    const parsed = deploymentStatusSchema.safeParse(payload);
    if (!parsed.success) {
      return null;
    }

    const deployment = parsed.data.deployment;
    const status = parsed.data.deployment_status;
    return {
      source: "github",
      kind: "github.deployment_status",
      externalId: `deployment_status:${status.id ?? deployment.id ?? "unknown"}:${status.state}`,
      repoOwner: parsed.data.repository.owner.login,
      repoName: parsed.data.repository.name,
      action: status.state,
      ref: deployment.ref,
      sha: deployment.sha,
      branch: deployment.ref,
      environment: status.environment ?? deployment.environment,
      deploymentUrl: status.target_url ?? undefined,
      url: status.target_url ?? undefined,
      actor: parsed.data.sender?.login,
    };
  }

  return null;
}
