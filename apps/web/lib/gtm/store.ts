import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  type GtmAccount,
  type GtmContact,
  type GtmEvent,
  type NewGtmAccount,
  gtmAccounts,
  gtmContacts,
  gtmEvents,
} from "@/lib/db/schema";
import { buildGtmEventInsert } from "./events";
import { redactGtmPayload } from "./redaction";
import { GtmError } from "./types";

type GtmDatabase = typeof db;

export interface CreateGtmAccountInput {
  userId: string;
  requestId: string;
  name: string;
  domain?: string | null;
  sourceKind?: NewGtmAccount["sourceKind"];
  externalSource?: string | null;
  externalId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpsertGtmContactInput {
  userId: string;
  requestId: string;
  accountId?: string | null;
  name: string;
  role?: string | null;
  emailHash?: string | null;
  externalSource?: string | null;
  externalId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function appendDbGtmEvent(
  input: Parameters<typeof buildGtmEventInsert>[0],
  database: GtmDatabase = db,
): Promise<GtmEvent> {
  const [row] = await database
    .insert(gtmEvents)
    .values(buildGtmEventInsert(input))
    .returning();
  if (!row) {
    throw new GtmError("ledger_append_failed", "GTM ledger append failed.");
  }
  return row;
}

export async function createGtmAccount(
  input: CreateGtmAccountInput,
  database: GtmDatabase = db,
): Promise<GtmAccount> {
  if (!input.name.trim()) {
    throw new GtmError("invalid_input", "Account name is required.");
  }

  return database.transaction(async (tx) => {
    const now = new Date();
    const [account] = await tx
      .insert(gtmAccounts)
      .values({
        id: crypto.randomUUID(),
        userId: input.userId,
        name: input.name.trim(),
        domain: input.domain ?? null,
        sourceKind: input.sourceKind ?? "manual",
        externalSource: input.externalSource ?? null,
        externalId: input.externalId ?? null,
        metadata: redactGtmPayload(input.metadata ?? {}),
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!account) {
      throw new GtmError("persistence_failed", "Account insert failed.");
    }

    const [event] = await tx
      .insert(gtmEvents)
      .values(
        buildGtmEventInsert({
          userId: input.userId,
          requestId: input.requestId,
          eventName: "gtm.account.created",
          entityKind: "account",
          entityId: account.id,
          status: "succeeded",
          payload: {
            accountId: account.id,
            sourceKind: account.sourceKind,
            domain: account.domain,
            metadata: input.metadata ?? {},
          },
        }),
      )
      .returning();

    if (!event) {
      throw new GtmError(
        "ledger_append_failed",
        "Account ledger append failed.",
      );
    }

    return account;
  });
}

export async function upsertGtmContact(
  input: UpsertGtmContactInput,
  database: GtmDatabase = db,
): Promise<GtmContact> {
  if (!input.name.trim()) {
    throw new GtmError("invalid_input", "Contact name is required.");
  }

  return database.transaction(async (tx) => {
    if (input.accountId) {
      const [account] = await tx
        .select({ id: gtmAccounts.id })
        .from(gtmAccounts)
        .where(
          and(
            eq(gtmAccounts.id, input.accountId),
            eq(gtmAccounts.userId, input.userId),
          ),
        );

      if (!account) {
        throw new GtmError(
          "cross_user_reference",
          "Contact account does not belong to the requesting user.",
        );
      }
    }

    const now = new Date();
    const [contact] = await tx
      .insert(gtmContacts)
      .values({
        id: crypto.randomUUID(),
        userId: input.userId,
        accountId: input.accountId ?? null,
        name: input.name.trim(),
        role: input.role ?? null,
        emailHash: input.emailHash ?? null,
        externalSource: input.externalSource ?? null,
        externalId: input.externalId ?? null,
        metadata: redactGtmPayload(input.metadata ?? {}),
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!contact) {
      throw new GtmError("persistence_failed", "Contact insert failed.");
    }

    const [event] = await tx
      .insert(gtmEvents)
      .values(
        buildGtmEventInsert({
          userId: input.userId,
          requestId: input.requestId,
          eventName: "gtm.contact.upserted",
          entityKind: "contact",
          entityId: contact.id,
          status: "succeeded",
          payload: {
            contactId: contact.id,
            accountId: contact.accountId,
            metadata: input.metadata ?? {},
          },
        }),
      )
      .returning();

    if (!event) {
      throw new GtmError(
        "ledger_append_failed",
        "Contact ledger append failed.",
      );
    }

    return contact;
  });
}
