import "server-only";

import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { getComposioConfig } from "./config";

type ComposioClient = Composio<VercelProvider>;

let cachedClient: ComposioClient | null = null;
let cachedApiKey: string | null = null;

export function getComposioClient(): ComposioClient {
  const config = getComposioConfig();
  if (!config.configured) {
    throw new Error("COMPOSIO_API_KEY is not configured.");
  }

  if (cachedClient && cachedApiKey === config.apiKey) {
    return cachedClient;
  }

  cachedApiKey = config.apiKey;
  cachedClient = new Composio({
    apiKey: config.apiKey,
    provider: new VercelProvider(),
  });
  return cachedClient;
}
