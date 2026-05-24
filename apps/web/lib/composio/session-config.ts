import { createHash } from "crypto";
import type { ToolRouterCreateSessionConfig } from "@composio/core";
import type { ComposioToolProfile } from "@/lib/db/schema";
import { getComposioProfileConfigHashInput } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }

  if (!isRecord(value)) {
    return JSON.stringify(value);
  }

  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`,
    );

  return `{${entries.join(",")}}`;
}

export function getComposioProfileConfigHash(
  profile: ComposioToolProfile,
): string {
  const hashInput = getComposioProfileConfigHashInput(profile);
  return createHash("sha256")
    .update(stableJsonStringify(hashInput))
    .digest("hex");
}

function pruneEmptyRecord<T>(
  value: Record<string, T>,
): Record<string, T> | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

export function buildComposioSessionConfig(
  profile: ComposioToolProfile,
): ToolRouterCreateSessionConfig {
  const authConfigs = Object.fromEntries(
    Object.entries(profile.authConfigIdsByToolkit).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const connectedAccounts = Object.fromEntries(
    Object.entries(profile.connectedAccountIdsByToolkit).filter(
      ([, ids]) => ids.length > 0,
    ),
  );

  return {
    toolkits: profile.toolkitSlugs,
    ...(pruneEmptyRecord(authConfigs) ? { authConfigs } : {}),
    ...(pruneEmptyRecord(connectedAccounts) ? { connectedAccounts } : {}),
    manageConnections: profile.allowInChatConnectionManagement
      ? { enable: true }
      : false,
    workbench: {
      enable: profile.workbenchEnabled,
    },
  };
}
