import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dirname, "..");
for (const filename of [".env.local", ".env"]) {
  const envPath = join(appRoot, filename);
  if (existsSync(envPath)) {
    loadEnv({ path: envPath, override: false });
  }
}

const apiKey = process.env.COMPOSIO_API_KEY?.trim();
if (!apiKey) {
  console.log("Skipping Composio smoke: COMPOSIO_API_KEY is not configured.");
  process.exit(0);
}

const toolkit = process.env.COMPOSIO_SMOKE_TOOLKIT?.trim() || "hackernews";
const userId = "open_agents_smoke";

const composio = new Composio({
  apiKey,
  provider: new VercelProvider(),
});

function redactSecretFragments(value: string): string {
  return value.replace(/ak_[A-Za-z0-9_*.-]+/g, "ak_[redacted]");
}

try {
  const session = await composio.create(userId, {
    toolkits: [toolkit],
    manageConnections: false,
    workbench: {
      enable: false,
    },
  });
  const tools = await session.tools();
  const toolNames = Object.keys(tools);

  if (toolNames.length === 0) {
    throw new Error(`Composio returned no tools for toolkit "${toolkit}".`);
  }

  console.log(
    `Composio smoke passed: ${toolNames.length} tools available for "${toolkit}" in session ${session.sessionId}.`,
  );
} catch (error) {
  const message = redactSecretFragments(
    error instanceof Error ? error.message : String(error),
  );
  console.error(`Composio smoke failed for toolkit "${toolkit}": ${message}`);
  process.exit(1);
}
