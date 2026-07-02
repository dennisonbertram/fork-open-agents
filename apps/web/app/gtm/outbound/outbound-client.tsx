"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  MailPlus,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type {
  CreateGtmOutboundDraftResult,
  GtmOutboundActionKind,
} from "@/lib/gtm-outbound/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApprovalDecisionControls } from "../_components/approval-decision-controls";

const ACTION_LABELS: Record<GtmOutboundActionKind, string> = {
  email_create_draft: "Create email draft",
  email_send: "Send email",
  crm_note_create: "Create CRM note",
  crm_contact_update: "Update CRM contact",
  crm_sequence_enroll: "Enroll in CRM sequence",
};

function statusVariant(status: string) {
  if (status === "pending_approval" || status === "pending") {
    return "secondary" as const;
  }
  if (status === "approved") {
    return "default" as const;
  }
  return "outline" as const;
}

function splitDomains(value: string) {
  return value
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

export function OutboundApprovalResult({
  result,
  subject,
  body,
  recipientDomain,
}: {
  result: CreateGtmOutboundDraftResult;
  subject: string;
  body: string;
  recipientDomain: string;
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Outbound approval</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Local draft created. External mutation remains blocked until a
              human approves this approval record.
            </p>
          </div>
          <Badge variant={statusVariant(result.status)}>{result.status}</Badge>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border p-3 text-sm">
            <div className="text-muted-foreground">Touchpoint</div>
            <div className="mt-1 font-medium">{result.touchpointId}</div>
          </div>
          <div className="rounded-md border border-border p-3 text-sm">
            <div className="text-muted-foreground">Approval</div>
            <div className="mt-1 font-medium">{result.approvalId}</div>
            <div className="mt-3">
              <ApprovalDecisionControls approvalId={result.approvalId} />
            </div>
          </div>
          <div className="rounded-md border border-border p-3 text-sm">
            <div className="text-muted-foreground">Recipient domain</div>
            <div className="mt-1 font-medium">
              {recipientDomain || "not set"}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Draft preview</h2>
          </div>
          <div className="rounded-md border border-border p-4">
            <div className="text-sm text-muted-foreground">Subject</div>
            <h3 className="mt-1 font-medium">{subject}</h3>
            <div className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">
              {body}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Policy boundary</h2>
          </div>
          <div className="rounded-md border border-border p-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{result.policy.actionKind}</Badge>
              <Badge variant={statusVariant(result.policy.reason)}>
                {result.policy.reason}
              </Badge>
              <Badge variant="outline">
                approval required: {String(result.policy.requiresApproval)}
              </Badge>
              <Badge variant="outline">
                external mutation:{" "}
                {String(result.policy.externalMutationAllowed)}
              </Badge>
            </div>
            <p className="mt-3 text-muted-foreground">
              The system stored an approval request and did not call Gmail, CRM,
              sequence, or send tools.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

export function GtmOutboundClient() {
  const [actionKind, setActionKind] =
    useState<GtmOutboundActionKind>("email_send");
  const [recipientDomain, setRecipientDomain] = useState("example.com");
  const [allowedDomains, setAllowedDomains] = useState("example.com");
  const [subject, setSubject] = useState("Following up on your agent workflow");
  const [body, setBody] = useState(
    "Hi Jordan,\n\nI noticed your team is evaluating agentic developer workflows. Open Agents may be useful for a safe internal pilot.\n\nWould it be helpful to compare notes this week?",
  );
  const [summary, setSummary] = useState(
    "Founder follow-up for an account evaluating agentic developer workflows.",
  );
  const [result, setResult] = useState<CreateGtmOutboundDraftResult | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  async function createDraft() {
    setCreating(true);
    try {
      const response = await fetch("/api/gtm/outbound/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionKind,
          recipientDomain,
          allowedDomains: splitDomains(allowedDomains),
          subject,
          body,
          summary,
          recipientHash: recipientDomain ? `domain:${recipientDomain}` : null,
          evidenceRefs: [
            {
              sourceType: "manual",
              recordId: "gtm-outbound-review-ui",
              excerpt: summary,
              retrievedAt: new Date().toISOString(),
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error("outbound draft failed");
      }

      const draft = (await response.json()) as CreateGtmOutboundDraftResult;
      setResult(draft);
      toast.success("Outbound approval created");
    } catch {
      toast.error("Failed to create outbound approval");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="gtm-outbound-action">Action</Label>
            <select
              id="gtm-outbound-action"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={actionKind}
              onChange={(event) =>
                setActionKind(event.target.value as GtmOutboundActionKind)
              }
            >
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gtm-outbound-recipient-domain">
              Recipient domain
            </Label>
            <Input
              id="gtm-outbound-recipient-domain"
              value={recipientDomain}
              onChange={(event) => setRecipientDomain(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gtm-outbound-allowed-domains">
              Allowed domains
            </Label>
            <Input
              id="gtm-outbound-allowed-domains"
              value={allowedDomains}
              onChange={(event) => setAllowedDomains(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="space-y-2">
            <Label htmlFor="gtm-outbound-subject">Subject</Label>
            <Input
              id="gtm-outbound-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gtm-outbound-summary">Personalization source</Label>
            <Input
              id="gtm-outbound-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="gtm-outbound-body">Body preview</Label>
          <Textarea
            id="gtm-outbound-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={7}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            Sends, CRM writes, and sequence changes remain blocked here.
          </div>
          <Button onClick={createDraft} disabled={creating}>
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MailPlus className="h-4 w-4" />
            )}
            Create approval
          </Button>
        </div>
      </section>

      {result ? (
        <OutboundApprovalResult
          result={result}
          subject={subject}
          body={body}
          recipientDomain={recipientDomain}
        />
      ) : (
        <Empty className="rounded-md border border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCircle2 />
            </EmptyMedia>
            <EmptyTitle>No outbound approval selected</EmptyTitle>
            <EmptyDescription>
              Create an outbound approval to persist a local draft, policy
              snapshot, and approval request without external mutation.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={createDraft} disabled={creating} variant="outline">
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MailPlus className="h-4 w-4" />
              )}
              Create approval
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </div>
  );
}
