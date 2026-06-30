import { redactGtmPayload, redactGtmText } from "@/lib/gtm/redaction";
import type {
  GtmAttentionReason,
  GtmBriefItem,
  GtmBriefResponse,
  GtmItemStatus,
  GtmNextAction,
  GtmSnapshotSource,
  GtmSourceStatus,
  GtmSourceStatusState,
} from "./types";

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 168;
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

type SourceLoader<T> = () => Promise<T[]>;

export interface GtmAccountRow {
  id: string;
  name: string;
  status: string;
  domain: string | null;
  sourceKind: string;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface GtmSignalRow {
  id: string;
  kind: string;
  status: string;
  confidence: string;
  summary: string;
  accountId: string | null;
  contactId: string | null;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface GtmExperimentRow {
  id: string;
  title: string;
  status: string;
  channel: string;
  outcomeSummary: string | null;
  updatedAt: Date;
}

export interface GtmApprovalRow {
  id: string;
  actionKind: string;
  targetKind: string;
  targetId: string;
  status: string;
  updatedAt: Date;
}

export interface GtmSnapshotLoaders {
  accounts: SourceLoader<GtmAccountRow>;
  signals: SourceLoader<GtmSignalRow>;
  experiments: SourceLoader<GtmExperimentRow>;
  approvals: SourceLoader<GtmApprovalRow>;
}

export interface GtmSnapshotOptions {
  userId: string;
  window: string | null;
  now?: Date;
  loaders?: Partial<GtmSnapshotLoaders>;
}

interface SnapshotWindow {
  requested: string;
  hours: number;
  since: Date;
}

export function parseGtmSnapshotWindow(
  rawWindow: string | null,
  now: Date,
): SnapshotWindow {
  const requested = rawWindow ?? `${DEFAULT_WINDOW_HOURS}h`;
  const match = /^(\d{1,3})h$/.exec(requested);
  const parsedHours = match ? Number(match[1]) : DEFAULT_WINDOW_HOURS;
  const hours =
    Number.isInteger(parsedHours) && parsedHours > 0
      ? Math.min(parsedHours, MAX_WINDOW_HOURS)
      : DEFAULT_WINDOW_HOURS;

  return {
    requested,
    hours,
    since: new Date(now.getTime() - hours * 60 * 60 * 1000),
  };
}

function diagnosisHref(source: GtmSnapshotSource, id: string): string {
  const params = new URLSearchParams({ source, id });
  return `/api/gtm/diagnosis?${params.toString()}`;
}

function redactedMetadata(
  value: Record<string, unknown>,
): Record<string, string | number | boolean | null> | undefined {
  const redacted = redactGtmPayload(value);
  const entries = Object.entries(redacted).flatMap(([key, item]) => {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      return [[key, item] as [string, string | number | boolean | null]];
    }
    return [];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function itemPriority(
  reasons: GtmAttentionReason[],
): "high" | "medium" | "low" {
  if (
    reasons.includes("pending_approval") ||
    reasons.includes("source_failed")
  ) {
    return "high";
  }
  if (
    reasons.includes("draft_signal") ||
    reasons.includes("stale_experiment")
  ) {
    return "medium";
  }
  return "low";
}

function staleStatus(updatedAt: Date, now: Date): GtmItemStatus {
  return now.getTime() - updatedAt.getTime() > STALE_AFTER_MS
    ? "stale"
    : "active";
}

export function normalizeGtmSignal(
  row: GtmSignalRow,
  now = new Date(),
): GtmBriefItem {
  const reasons: GtmAttentionReason[] =
    row.status === "draft" ? ["draft_signal"] : [];
  const status =
    row.status === "active" ? staleStatus(row.updatedAt, now) : "draft";

  return {
    id: row.id,
    source: "account_work",
    title: redactGtmText(`${row.kind}: ${row.summary}`, 140) ?? "GTM signal",
    status,
    needsAttention: reasons.length > 0,
    attentionReasons: reasons,
    priority: itemPriority(reasons),
    updatedAt: row.updatedAt.toISOString(),
    summary: redactGtmText(row.summary, 240) ?? "Signal recorded",
    metadata: redactedMetadata({
      kind: row.kind,
      confidence: row.confidence,
      accountId: row.accountId,
      contactId: row.contactId,
      ...row.metadata,
    }),
    diagnosisHref: diagnosisHref("account_work", row.id),
  };
}

export function normalizeGtmExperiment(
  row: GtmExperimentRow,
  now = new Date(),
): GtmBriefItem {
  const status =
    row.status === "completed" ? "completed" : staleStatus(row.updatedAt, now);
  const reasons: GtmAttentionReason[] =
    status === "stale" ? ["stale_experiment"] : [];

  return {
    id: row.id,
    source: "distribution",
    title: redactGtmText(row.title, 140) ?? "GTM experiment",
    status,
    needsAttention: reasons.length > 0,
    attentionReasons: reasons,
    priority: itemPriority(reasons),
    updatedAt: row.updatedAt.toISOString(),
    summary:
      redactGtmText(row.outcomeSummary ?? row.channel, 240) ?? "Experiment",
    metadata: redactedMetadata({ channel: row.channel }),
    diagnosisHref: diagnosisHref("distribution", row.id),
  };
}

export function normalizeGtmApproval(row: GtmApprovalRow): GtmBriefItem {
  const reasons: GtmAttentionReason[] =
    row.status === "pending" ? ["pending_approval"] : [];

  return {
    id: row.id,
    source: "inbound",
    title: redactGtmText(`${row.actionKind} approval`, 140) ?? "GTM approval",
    status: row.status === "pending" ? "pending_approval" : "completed",
    needsAttention: reasons.length > 0,
    attentionReasons: reasons,
    priority: itemPriority(reasons),
    updatedAt: row.updatedAt.toISOString(),
    summary: `Review ${row.targetKind} ${row.targetId}`,
    metadata: redactedMetadata({
      actionKind: row.actionKind,
      targetKind: row.targetKind,
      targetId: row.targetId,
    }),
    diagnosisHref: diagnosisHref("inbound", row.id),
  };
}

async function loadSource<T>(
  source: GtmSnapshotSource,
  loader: SourceLoader<T>,
): Promise<{ sourceStatus: GtmSourceStatus; items: T[] }> {
  try {
    const items = await loader();
    return {
      items,
      sourceStatus: {
        source,
        status: items.length > 0 ? "healthy" : "missing",
        itemCount: items.length,
        summary:
          items.length > 0
            ? undefined
            : "No connected or recent GTM evidence was found for this source.",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      items: [],
      sourceStatus: {
        source,
        status: "failed",
        itemCount: 0,
        errorKind: "gtm_source_schema_mismatch",
        summary:
          redactGtmText(message) === undefined
            ? "Source failed"
            : "Source failed",
      },
    };
  }
}

function section(
  items: GtmBriefItem[],
  predicate: (item: GtmBriefItem) => boolean,
) {
  return items
    .filter(predicate)
    .sort((a, b) => {
      const priority = { high: 0, medium: 1, low: 2 };
      const priorityDelta = priority[a.priority] - priority[b.priority];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .slice(0, 25);
}

function buildNextActions(
  items: GtmBriefItem[],
  sourceStatus: GtmSourceStatus[],
): GtmNextAction[] {
  const actions: GtmNextAction[] = [];
  const pendingApproval = items.find((item) =>
    item.attentionReasons.includes("pending_approval"),
  );
  if (pendingApproval) {
    actions.push({
      id: `review-${pendingApproval.id}`,
      label: "review pending GTM approval",
      priority: "high",
      requiresAuthorization: true,
      evidence: [
        {
          source: pendingApproval.source,
          id: pendingApproval.id,
          href: pendingApproval.diagnosisHref,
        },
      ],
    });
  }

  const failedSource = sourceStatus.find(
    (source) => source.status === "failed",
  );
  if (failedSource) {
    actions.push({
      id: `fix-${failedSource.source}`,
      label: "fix expired or failing GTM source",
      priority: "high",
      requiresAuthorization: false,
      evidence: [
        {
          source: failedSource.source,
          id: failedSource.source,
          href: "/api/gtm/brief",
        },
      ],
    });
  }

  return actions.slice(0, 10);
}

export async function buildGtmSnapshot(
  options: GtmSnapshotOptions,
): Promise<GtmBriefResponse> {
  const now = options.now ?? new Date();
  const window = parseGtmSnapshotWindow(options.window, now);
  const emptyLoader = async () => [];
  const loaders: GtmSnapshotLoaders = {
    accounts: options.loaders?.accounts ?? emptyLoader,
    signals: options.loaders?.signals ?? emptyLoader,
    experiments: options.loaders?.experiments ?? emptyLoader,
    approvals: options.loaders?.approvals ?? emptyLoader,
  };

  const [accountResult, signalResult, experimentResult, approvalResult] =
    await Promise.all([
      loadSource("audience", loaders.accounts),
      loadSource("account_work", loaders.signals),
      loadSource("distribution", loaders.experiments),
      loadSource("inbound", loaders.approvals),
    ]);

  const items = [
    ...signalResult.items.map((row) => normalizeGtmSignal(row, now)),
    ...experimentResult.items.map((row) => normalizeGtmExperiment(row, now)),
    ...approvalResult.items.map((row) => normalizeGtmApproval(row)),
  ];
  const sourceStatus: GtmSourceStatus[] = [
    accountResult.sourceStatus,
    signalResult.sourceStatus,
    experimentResult.sourceStatus,
    approvalResult.sourceStatus,
    {
      source: "product_shipments",
      status: "missing" satisfies GtmSourceStatusState,
      itemCount: 0,
      summary: "Product-shipment GTM source is not connected yet.",
    },
  ];

  return {
    generatedAt: now.toISOString(),
    window: {
      requested: window.requested,
      hours: window.hours,
      since: window.since.toISOString(),
    },
    sourceStatus,
    needsAttention: section(items, (item) => item.needsAttention),
    running: section(items, (item) => item.status === "running"),
    recentlyCompleted: section(items, (item) => item.status === "completed"),
    waiting: section(items, (item) => item.status === "pending_approval"),
    stale: section(items, (item) => item.status === "stale"),
    nextActions: buildNextActions(items, sourceStatus),
  };
}
