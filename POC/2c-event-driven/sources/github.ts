import { z } from "zod";
import type { AgentEvent, EventSource, RawInbound } from "../types";
import { safeEqual, sha256Hex } from "./verify";

/**
 * GitHub source — subsumes the production
 * `apps/web/app/api/github/webhook/route.ts` verification + normalization.
 *
 * Signature: header `x-hub-signature-256: sha256=<hex>`, HMAC-SHA256 over the
 * raw body (identical to `verifySignature` in the real route).
 * Event name: header `x-github-event`.
 */

const repositorySchema = z.object({
  name: z.string(),
  owner: z.object({ login: z.string() }),
});

const senderSchema = z.object({ login: z.string() }).optional();

const pullRequestSchema = z.object({
  action: z.string(),
  repository: repositorySchema,
  sender: senderSchema,
  pull_request: z.object({
    id: z.number().optional(),
    number: z.number(),
    title: z.string().optional(),
    body: z.string().nullable().optional(),
    merged: z.boolean().optional(),
    html_url: z.string().optional(),
    head: z.object({ ref: z.string().optional(), sha: z.string().optional() }),
    base: z.object({ ref: z.string().optional() }),
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
    body: z.string().nullable().optional(),
    html_url: z.string().optional(),
    labels: z.array(z.object({ name: z.string() })).optional(),
  }),
});

export const githubSource: EventSource = {
  id: "github",
  matchesInbound: (inbound) => "x-github-event" in inbound.headers,
  verify: (inbound, secret) => {
    const provided = inbound.headers["x-hub-signature-256"];
    if (!provided) {
      return { ok: false, reason: "missing x-hub-signature-256 header" };
    }
    const expected = `sha256=${sha256Hex(secret, inbound.rawBody)}`;
    if (!safeEqual(expected, provided)) {
      return { ok: false, reason: "signature mismatch" };
    }
    return { ok: true };
  },
  normalize: (parsed, inbound) => {
    const eventName = inbound.headers["x-github-event"];

    if (eventName === "pull_request") {
      const r = pullRequestSchema.safeParse(parsed);
      if (!r.success) {
        return [];
      }
      const pr = r.data.pull_request;
      // Mirror the production prStatus derivation so the PR-close rule can
      // act on the exact same signal the original handler used.
      const prStatus =
        r.data.action === "closed"
          ? pr.merged
            ? "merged"
            : "closed"
          : r.data.action === "reopened"
            ? "open"
            : r.data.action;
      const event: AgentEvent = {
        source: "github",
        type: `github.pull_request.${r.data.action}`,
        externalId: `pull_request:${pr.id ?? pr.number}:${r.data.action}:${pr.head.sha ?? "unknown"}`,
        repo: { owner: r.data.repository.owner.login, name: r.data.repository.name },
        actor: r.data.sender?.login,
        subject: pr.title ?? `PR #${pr.number}`,
        body: pr.body ?? undefined,
        metadata: {
          action: r.data.action,
          prNumber: pr.number,
          prStatus,
          merged: pr.merged ?? false,
          branch: pr.base.ref ?? null,
          headRef: pr.head.ref ?? null,
          url: pr.html_url ?? null,
        },
      };
      return [event];
    }

    if (eventName === "issues") {
      const r = issuesSchema.safeParse(parsed);
      if (!r.success) {
        return [];
      }
      const issue = r.data.issue;
      const event: AgentEvent = {
        source: "github",
        type: `github.issues.${r.data.action}`,
        externalId: `issue:${issue.id ?? issue.number}:${r.data.action}`,
        repo: { owner: r.data.repository.owner.login, name: r.data.repository.name },
        actor: r.data.sender?.login,
        subject: issue.title ?? `Issue #${issue.number}`,
        body: issue.body ?? undefined,
        metadata: {
          action: r.data.action,
          issueNumber: issue.number,
          labels: (issue.labels ?? []).map((l) => l.name).join(","),
          url: issue.html_url ?? null,
        },
      };
      return [event];
    }

    // ping, installation, and other events: recognized, not translated.
    return [];
  },
};

export const githubSchemas = { pullRequestSchema, issuesSchema };

export type GithubInbound = RawInbound;
