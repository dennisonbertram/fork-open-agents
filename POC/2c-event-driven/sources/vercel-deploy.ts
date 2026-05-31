import { z } from "zod";
import type { AgentEvent, EventSource } from "../types";
import { safeEqual, sha1Hex } from "./verify";

/**
 * Vercel deployment source (deploy-failed showcase).
 *
 * Signature (per Vercel webhook docs): header `x-vercel-signature`,
 * HMAC-**SHA1** over the raw body, hex — a third distinct scheme (different
 * algorithm from GitHub/AgentMail's SHA256). This is the per-source auth
 * difference the POC must prove.
 *
 * Payload: `{ id, type, createdAt, region, payload: { deployment, project,
 * target, links, ... } }`. We translate `deployment.error` (and the alias
 * `deployment.failed`) into a `deploy.failed` event.
 */

const deploymentSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  url: z.string().optional(),
  meta: z
    .object({
      githubCommitOrg: z.string().optional(),
      githubCommitRepo: z.string().optional(),
      githubCommitRef: z.string().optional(),
      githubCommitSha: z.string().optional(),
    })
    .partial()
    .optional(),
});

const webhookSchema = z.object({
  id: z.string(),
  type: z.string(),
  createdAt: z.number().optional(),
  region: z.string().nullable().optional(),
  payload: z.object({
    deployment: deploymentSchema,
    project: z.object({ id: z.string() }).optional(),
    target: z.string().nullable().optional(),
    links: z
      .object({ deployment: z.string().optional(), project: z.string().optional() })
      .optional(),
  }),
});

const FAILED_TYPES = new Set(["deployment.error", "deployment.failed"]);

export const vercelDeploySource: EventSource = {
  id: "vercel-deploy",
  matchesInbound: (inbound) => "x-vercel-signature" in inbound.headers,
  verify: (inbound, secret) => {
    const provided = inbound.headers["x-vercel-signature"];
    if (!provided) {
      return { ok: false, reason: "missing x-vercel-signature header" };
    }
    const expected = sha1Hex(secret, inbound.rawBody);
    if (!safeEqual(expected, provided)) {
      return { ok: false, reason: "signature mismatch" };
    }
    return { ok: true };
  },
  normalize: (parsed) => {
    const r = webhookSchema.safeParse(parsed);
    if (!r.success) {
      return [];
    }
    if (!FAILED_TYPES.has(r.data.type)) {
      // deployment.created / .succeeded / etc — recognized, not woken on.
      return [];
    }
    const d = r.data.payload.deployment;
    const meta = d.meta ?? {};
    const repo =
      meta.githubCommitOrg && meta.githubCommitRepo
        ? { owner: meta.githubCommitOrg, name: meta.githubCommitRepo }
        : undefined;
    const event: AgentEvent = {
      source: "vercel-deploy",
      type: "deploy.failed",
      externalId: `vercel:${r.data.id}:${d.id}`,
      repo,
      actor: "vercel",
      subject: `Deployment failed: ${d.name ?? d.id}`,
      body: d.url ? `Failed deployment URL: ${d.url}` : undefined,
      metadata: {
        deploymentId: d.id,
        deploymentUrl: d.url ?? null,
        projectName: d.name ?? null,
        target: r.data.payload.target ?? null,
        inspectorUrl: r.data.payload.links?.deployment ?? null,
        branch: meta.githubCommitRef ?? null,
        sha: meta.githubCommitSha ?? null,
      },
      occurredAt: r.data.createdAt ? new Date(r.data.createdAt).toISOString() : undefined,
    };
    return [event];
  },
};

export const vercelDeploySchemas = { webhookSchema };
