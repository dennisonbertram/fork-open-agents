import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  decryptInferenceSecret,
  encryptInferenceSecret,
} from "@/lib/inference/encryption";
import { db } from "@/lib/db/client";
import { mcpServers } from "@/lib/db/schema";
import {
  McpServerConflictError,
  type CreateMcpServerInput,
  type UpdateMcpServerInput,
} from "./types";

/**
 * Returns true when `err` (or any error in its cause chain) is a PostgreSQL
 * unique-constraint violation (SQLSTATE 23505). Drizzle-orm 0.45 wraps the
 * pg error, so `err.message` is a "Failed query: …" string while the original
 * pg error — with `.code === "23505"` — lives on `err.cause`.
 */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  while (current != null && typeof current === "object") {
    const e = current as Record<string, unknown>;
    if (e["code"] === "23505") return true;
    current = e["cause"];
  }
  return false;
}

// ── Encryption helpers ────────────────────────────────────────────────────────

/**
 * Serialize and encrypt a headers record. Returns the encrypted string.
 * Never logs header values.
 */
export function encryptMcpHeaders(headers: Record<string, string>): string {
  return encryptInferenceSecret(JSON.stringify(headers));
}

/**
 * Decrypt an encrypted headers string. Returns null when passed null (no headers stored).
 */
export function decryptMcpHeaders(
  encrypted: string | null,
): Record<string, string> | null {
  if (!encrypted) return null;
  try {
    return JSON.parse(decryptInferenceSecret(encrypted)) as Record<
      string,
      string
    >;
  } catch {
    return null;
  }
}

// ── Public summary type — header VALUES never leave ───────────────────────────

export type McpServerSummary = {
  id: string;
  name: string;
  url: string;
  transport: "http" | "sse";
  enabled: boolean;
  /** Header key names only — values are write-only. */
  headerKeys: string[];
  hasHeaders: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toSummary(row: typeof mcpServers.$inferSelect): McpServerSummary {
  const headerKeys = row.headersEncrypted
    ? (() => {
        const decoded = decryptMcpHeaders(row.headersEncrypted);
        return decoded ? Object.keys(decoded) : [];
      })()
    : [];

  return {
    id: row.id,
    name: row.name,
    url: row.url,
    transport: row.transport,
    enabled: row.enabled,
    headerKeys,
    hasHeaders: headerKeys.length > 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── CRUD operations ───────────────────────────────────────────────────────────

export async function listMcpServers(
  userId: string,
): Promise<McpServerSummary[]> {
  const rows = await db.query.mcpServers.findMany({
    where: eq(mcpServers.userId, userId),
    orderBy: [desc(mcpServers.updatedAt)],
  });
  return rows.map(toSummary);
}

export async function createMcpServer(
  userId: string,
  input: CreateMcpServerInput,
): Promise<McpServerSummary> {
  const headersEncrypted =
    input.headers && Object.keys(input.headers).length > 0
      ? encryptMcpHeaders(input.headers)
      : null;

  try {
    const [created] = await db
      .insert(mcpServers)
      .values({
        id: nanoid(),
        userId,
        name: input.name,
        url: input.url,
        transport: input.transport,
        headersEncrypted,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create MCP server");
    }

    return toSummary(created);
  } catch (err) {
    if (isUniqueViolation(err)) throw new McpServerConflictError();
    throw err;
  }
}

export async function updateMcpServer(
  userId: string,
  serverId: string,
  input: UpdateMcpServerInput,
): Promise<McpServerSummary | null> {
  const existing = await db.query.mcpServers.findFirst({
    where: and(eq(mcpServers.userId, userId), eq(mcpServers.id, serverId)),
  });

  if (!existing) return null;

  const patch: Partial<typeof mcpServers.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) patch.name = input.name;
  if (input.url !== undefined) patch.url = input.url;
  if (input.transport !== undefined) patch.transport = input.transport;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  if (input.headers === null) {
    // Explicit null clears headers
    patch.headersEncrypted = null;
  } else if (
    input.headers !== undefined &&
    Object.keys(input.headers).length > 0
  ) {
    patch.headersEncrypted = encryptMcpHeaders(input.headers);
  }

  try {
    const [updated] = await db
      .update(mcpServers)
      .set(patch)
      .where(and(eq(mcpServers.userId, userId), eq(mcpServers.id, serverId)))
      .returning();

    return updated ? toSummary(updated) : null;
  } catch (err) {
    if (isUniqueViolation(err)) throw new McpServerConflictError();
    throw err;
  }
}

export async function deleteMcpServer(
  userId: string,
  serverId: string,
): Promise<boolean> {
  const result = await db
    .delete(mcpServers)
    .where(and(eq(mcpServers.userId, userId), eq(mcpServers.id, serverId)))
    .returning({ id: mcpServers.id });

  return result.length > 0;
}

/**
 * Returns decrypted header values — reserved for chat-time tool injection (slice 2).
 * Not exposed in settings API responses.
 */
export async function getDecryptedHeaders(
  userId: string,
  serverId: string,
): Promise<Record<string, string> | null> {
  const row = await db.query.mcpServers.findFirst({
    where: and(eq(mcpServers.userId, userId), eq(mcpServers.id, serverId)),
  });

  if (!row) return null;
  return decryptMcpHeaders(row.headersEncrypted ?? null);
}
