import { nanoid } from "nanoid";
import type { BackgroundAgentTriggerKind } from "./types";

type ExistingTrigger = {
  kind: BackgroundAgentTriggerKind;
  webhookPublicId: string | null;
};

type TriggerInput = {
  kind: BackgroundAgentTriggerKind;
};

export function getWebhookPublicIdForUpdatedTrigger(params: {
  trigger: TriggerInput;
  existingWebhookPublicIds: string[];
}): string | null {
  if (params.trigger.kind !== "webhook.error") {
    return null;
  }

  return params.existingWebhookPublicIds.shift() ?? nanoid(16);
}

export function getExistingWebhookPublicIds(
  triggers: ExistingTrigger[],
): string[] {
  return triggers
    .filter((trigger) => trigger.kind === "webhook.error")
    .map((trigger) => trigger.webhookPublicId)
    .filter((publicId): publicId is string => publicId !== null);
}
