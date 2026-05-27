import { z } from "zod";
import { getBackgroundAgentsWebhookSecret } from "@/lib/background-agents/config";
import { dispatchWebhookErrorEvent } from "@/lib/background-agents/dispatcher";
import { verifyBackgroundWebhookSignature } from "@/lib/background-agents/signature";

const webhookErrorSchema = z
  .object({
    externalId: z.string().min(1),
    repoOwner: z.string().min(1).optional(),
    repoName: z.string().min(1).optional(),
    severity: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
    url: z.string().url().optional(),
    actor: z.string().min(1).optional(),
    occurredAt: z.string().min(1).optional(),
  })
  .strict();

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

export async function POST(req: Request, context: RouteContext) {
  const secret = getBackgroundAgentsWebhookSecret();
  if (!secret) {
    return Response.json(
      { error: "BACKGROUND_AGENTS_WEBHOOK_SECRET is not configured" },
      { status: 500 },
    );
  }

  const payloadText = await req.text();
  const signature = req.headers.get("x-open-agents-signature");
  if (
    !verifyBackgroundWebhookSignature({
      payload: payloadText,
      signatureHeader: signature,
      secret,
    })
  ) {
    return Response.json(
      { error: "Invalid webhook signature" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(payloadText);
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = webhookErrorSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  const { publicId } = await context.params;
  const result = await dispatchWebhookErrorEvent({
    webhookPublicId: publicId,
    event: parsed.data,
    requestId: req.headers.get("x-request-id"),
  });

  return Response.json(result);
}
