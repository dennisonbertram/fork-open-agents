import "server-only";

export function isBackgroundAgentsEnabled(): boolean {
  return process.env.BACKGROUND_AGENTS_ENABLED === "true";
}

export function getBackgroundAgentsCronSecret(): string | null {
  return (
    process.env.BACKGROUND_AGENTS_CRON_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    null
  );
}

export function getBackgroundAgentsWebhookSecret(): string | null {
  return process.env.BACKGROUND_AGENTS_WEBHOOK_SECRET?.trim() || null;
}
