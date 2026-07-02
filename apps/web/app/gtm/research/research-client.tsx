"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { AccountBriefDraft } from "@/lib/gtm-research/types";
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

type ResearchRunResult = {
  runId: string;
  brief: AccountBriefDraft;
  signalIds: string[];
};

type ClaimDraft = {
  id: string;
  text: string;
  evidenceSourceType: "manual" | "crm" | "public_url" | "product";
  evidenceRef: string;
  privateFact: boolean;
};

const INITIAL_CLAIMS: ClaimDraft[] = [
  {
    id: "claim-1",
    text: "The account is actively evaluating agentic developer tools for internal engineering workflows.",
    evidenceSourceType: "manual",
    evidenceRef: "founder-note",
    privateFact: false,
  },
  {
    id: "claim-2",
    text: "Unconfirmed budget owner is the VP of Engineering.",
    evidenceSourceType: "public_url",
    evidenceRef: "",
    privateFact: true,
  },
];

function statusVariant(status: string) {
  if (status === "draft" || status === "medium") {
    return "secondary" as const;
  }
  if (status === "high" || status === "approved") {
    return "default" as const;
  }
  return "outline" as const;
}

function evidenceHref(ref: {
  url?: string;
  recordId?: string;
  sourceType: string;
}) {
  if (ref.url) {
    return ref.url;
  }
  if (ref.recordId) {
    return `${ref.sourceType}:${ref.recordId}`;
  }
  return ref.sourceType;
}

function claimToPayload(claim: ClaimDraft) {
  const ref = claim.evidenceRef.trim();
  return {
    text: claim.text,
    privateFact: claim.privateFact,
    evidenceRefs: ref
      ? [
          {
            sourceType: claim.evidenceSourceType,
            ...(claim.evidenceSourceType === "public_url"
              ? { url: ref }
              : { recordId: ref }),
            excerpt: claim.text.slice(0, 180),
            retrievedAt: new Date().toISOString(),
          },
        ]
      : [],
  };
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ResearchResult({ result }: { result: ResearchRunResult }) {
  const { brief } = result;

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Research run</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {brief.citedFacts.length} cited facts,{" "}
              {brief.unknownClaims.length} unknown claims,{" "}
              {result.signalIds.length} draft signals
            </p>
          </div>
          <Badge variant="secondary">draft-only</Badge>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Cited account brief</h2>
          </div>
          {brief.citedFacts.length === 0 ? (
            <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
              No cited facts were accepted for this run.
            </div>
          ) : (
            <div className="space-y-2">
              {brief.citedFacts.map((claim) => (
                <div
                  key={claim.text}
                  className="rounded-md border border-border p-4 text-sm"
                >
                  <p className="font-medium">{claim.text}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {claim.evidenceRefs.map((ref) => (
                      <Badge key={evidenceHref(ref)} variant="outline">
                        {ref.sourceType}: {evidenceHref(ref)}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Unknown or rejected claims</h2>
          </div>
          {brief.unknownClaims.length === 0 ? (
            <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
              No unsupported claims were found.
            </div>
          ) : (
            <div className="space-y-2">
              {brief.unknownClaims.map((claim) => (
                <div
                  key={claim.text}
                  className="rounded-md border border-border p-3 text-sm"
                >
                  <Badge variant="outline">{claim.reason}</Badge>
                  <p className="mt-2 text-muted-foreground">{claim.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="font-medium">Open questions</h2>
          <div className="space-y-2">
            {brief.openQuestions.length === 0 ? (
              <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                No open questions captured.
              </div>
            ) : (
              brief.openQuestions.map((question) => (
                <div
                  key={question}
                  className="rounded-md border border-border p-3 text-sm"
                >
                  {question}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="font-medium">Recommended next steps</h2>
          <div className="space-y-2">
            {brief.nextSteps.length === 0 ? (
              <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                No next steps captured.
              </div>
            ) : (
              brief.nextSteps.map((step) => (
                <div
                  key={step}
                  className="rounded-md border border-border p-3 text-sm"
                >
                  {step}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium">Draft signal candidates</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {brief.signalCandidates.length === 0 ? (
            <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
              No draft signals were created.
            </div>
          ) : (
            brief.signalCandidates.map((signal, index) => (
              <div
                key={`${signal.kind}-${signal.summary}`}
                className="rounded-md border border-border p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-medium">{signal.summary}</h3>
                  <Badge variant={statusVariant(signal.status)}>
                    {signal.status}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline">{signal.kind}</Badge>
                  <Badge variant={statusVariant(signal.confidence)}>
                    {signal.confidence}
                  </Badge>
                  <Badge variant="outline">
                    {signal.evidenceRefs.length} evidence
                  </Badge>
                  {result.signalIds[index] ? (
                    <Badge variant="outline">{result.signalIds[index]}</Badge>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

export function GtmResearchClient() {
  const [accountName, setAccountName] = useState("Acme Infrastructure");
  const [contactName, setContactName] = useState("Jordan Lee");
  const [claims, setClaims] = useState<ClaimDraft[]>(INITIAL_CLAIMS);
  const [openQuestions, setOpenQuestions] = useState(
    "Who owns the first pilot decision?\nWhich existing workflow is most painful?",
  );
  const [nextSteps, setNextSteps] = useState(
    "Confirm the budget owner before drafting outreach.\nAsk for the current evaluation timeline.",
  );
  const [result, setResult] = useState<ResearchRunResult | null>(null);
  const [running, setRunning] = useState(false);

  function updateClaim(id: string, patch: Partial<ClaimDraft>) {
    setClaims((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function runResearch() {
    setRunning(true);
    try {
      const response = await fetch("/api/gtm/research/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountName,
          contactName,
          claims: claims.map(claimToPayload),
          openQuestions: splitLines(openQuestions),
          nextSteps: splitLines(nextSteps),
        }),
      });

      if (!response.ok) {
        throw new Error("research failed");
      }

      const body = (await response.json()) as ResearchRunResult;
      setResult(body);
      toast.success("Research brief created");
    } catch {
      toast.error("Failed to create research brief");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="gtm-research-account">Account</Label>
            <Input
              id="gtm-research-account"
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gtm-research-contact">Contact</Label>
            <Input
              id="gtm-research-contact"
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">Research claims</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Claims without usable citations stay unknown. Private facts
                require manual, CRM, or call evidence.
              </p>
            </div>
          </div>

          <div className="grid gap-3">
            {claims.map((claim, index) => (
              <div
                key={claim.id}
                className="grid gap-3 rounded-md border border-border p-3 lg:grid-cols-[1fr_160px_180px_auto]"
              >
                <div className="space-y-2">
                  <Label htmlFor={`gtm-research-claim-${index}`}>
                    Claim {index + 1}
                  </Label>
                  <Textarea
                    id={`gtm-research-claim-${index}`}
                    value={claim.text}
                    onChange={(event) =>
                      updateClaim(claim.id, { text: event.target.value })
                    }
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`gtm-research-source-${index}`}>Source</Label>
                  <select
                    id={`gtm-research-source-${index}`}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={claim.evidenceSourceType}
                    onChange={(event) =>
                      updateClaim(claim.id, {
                        evidenceSourceType: event.target
                          .value as ClaimDraft["evidenceSourceType"],
                      })
                    }
                  >
                    <option value="manual">Manual</option>
                    <option value="crm">CRM</option>
                    <option value="public_url">Public URL</option>
                    <option value="product">Product</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`gtm-research-ref-${index}`}>
                    Evidence ref
                  </Label>
                  <Input
                    id={`gtm-research-ref-${index}`}
                    value={claim.evidenceRef}
                    onChange={(event) =>
                      updateClaim(claim.id, {
                        evidenceRef: event.target.value,
                      })
                    }
                    placeholder="URL or record ID"
                  />
                </div>
                <label className="flex items-center gap-2 self-end rounded-md border border-border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={claim.privateFact}
                    onChange={(event) =>
                      updateClaim(claim.id, {
                        privateFact: event.target.checked,
                      })
                    }
                  />
                  Private fact
                </label>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="gtm-research-questions">Open questions</Label>
            <Textarea
              id="gtm-research-questions"
              value={openQuestions}
              onChange={(event) => setOpenQuestions(event.target.value)}
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gtm-research-next-steps">Next steps</Label>
            <Textarea
              id="gtm-research-next-steps"
              value={nextSteps}
              onChange={(event) => setNextSteps(event.target.value)}
              rows={4}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={runResearch} disabled={running}>
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Run research
          </Button>
        </div>
      </section>

      {result ? (
        <ResearchResult result={result} />
      ) : (
        <Empty className="rounded-md border border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileSearch />
            </EmptyMedia>
            <EmptyTitle>No research run selected</EmptyTitle>
            <EmptyDescription>
              Run account research to create a cited brief, unknown-claim list,
              draft signals, and approval-safe next steps.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={runResearch} disabled={running} variant="outline">
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Run research
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </div>
  );
}
