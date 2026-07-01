"use client";

import {
  CheckCircle2,
  Loader2,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type {
  CreateGtmCallDebriefResult,
  CreateGtmCallPrepResult,
} from "@/lib/gtm-call/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApprovalDecisionControls } from "../_components/approval-decision-controls";

function splitLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function statusVariant(status: string) {
  if (status === "pending" || status === "draft") {
    return "secondary" as const;
  }
  if (status === "positive" || status === "completed") {
    return "default" as const;
  }
  return "outline" as const;
}

export function CallPrepResult({
  result,
}: {
  result: CreateGtmCallPrepResult;
}) {
  return (
    <section className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Prep brief</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Call {result.callId} from run {result.runId}
          </p>
        </div>
        <Badge variant="secondary">draft</Badge>
      </div>
      <div>
        <div className="text-sm text-muted-foreground">Objective</div>
        <p className="mt-1 font-medium">{result.brief.objective}</p>
      </div>
      <p className="text-sm text-muted-foreground">
        {result.brief.conciseBrief}
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <h3 className="text-sm font-medium">Risks</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {result.brief.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-medium">Open loops</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {result.brief.openLoops.map((loop) => (
              <li key={loop}>{loop}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-medium">Suggested questions</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {result.brief.suggestedQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function CallDebriefResult({
  result,
}: {
  result: CreateGtmCallDebriefResult;
}) {
  return (
    <section className="space-y-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Debrief</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.debrief.nextSteps.length} next steps,{" "}
            {result.insightIds.length} draft insights,{" "}
            {result.approvalIds.length} pending approvals
          </p>
        </div>
        <Badge variant={statusVariant(result.debrief.sentiment)}>
          {result.debrief.sentiment}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">{result.debrief.summary}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Next steps</h3>
          {result.debrief.nextSteps.map((step) => (
            <div
              key={step.summary}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="font-medium">{step.summary}</div>
              <Badge className="mt-2" variant="outline">
                owner: {step.owner}
              </Badge>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Follow-up draft</h3>
          <div className="rounded-md border border-border p-3 text-sm">
            <div className="font-medium">
              {result.debrief.followUpDraft.subject}
            </div>
            <p className="mt-2 text-muted-foreground">
              {result.debrief.followUpDraft.bodyPreview}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Objections and product asks</h3>
          {[...result.debrief.objections, ...result.debrief.productAsks].map(
            (item) => (
              <div
                key={item}
                className="rounded-md border border-border p-3 text-sm text-muted-foreground"
              >
                {item}
              </div>
            ),
          )}
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Proposed actions</h3>
          </div>
          {result.debrief.proposedActions.map((action, index) => (
            <div
              key={`${action.actionKind}-${action.summary}`}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{action.actionKind}</Badge>
                <Badge variant="secondary">pending approval</Badge>
              </div>
              <p className="mt-2 text-muted-foreground">{action.summary}</p>
              {result.approvalIds[index] ? (
                <div className="mt-3 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    approval {result.approvalIds[index]}
                  </div>
                  <ApprovalDecisionControls
                    approvalId={result.approvalIds[index]}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function GtmCallsClient() {
  const [objective, setObjective] = useState(
    "Qualify whether the account has a near-term internal agent workflow pilot.",
  );
  const [knownContext, setKnownContext] = useState(
    "They are evaluating agentic developer workflows.\nSecurity review is a likely blocker.",
  );
  const [openLoops, setOpenLoops] = useState(
    "Need budget owner.\nNeed pilot success criteria.",
  );
  const [desiredOutcome, setDesiredOutcome] = useState(
    "Leave with a concrete pilot next step.",
  );
  const [notes, setNotes] = useState(
    "Jordan was excited about internal workflow automation. Concern is security review and budget timing. Next step is to send a short pilot plan and schedule a technical review. Product request: GitHub App install status should be clearer.",
  );
  const [attendees, setAttendees] = useState("Jordan Lee\nFounder");
  const [prep, setPrep] = useState<CreateGtmCallPrepResult | null>(null);
  const [debrief, setDebrief] = useState<CreateGtmCallDebriefResult | null>(
    null,
  );
  const [preparing, setPreparing] = useState(false);
  const [debriefing, setDebriefing] = useState(false);

  async function createPrep() {
    setPreparing(true);
    try {
      const response = await fetch("/api/gtm/calls/prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          founderObjective: objective,
          knownContext: splitLines(knownContext),
          openLoops: splitLines(openLoops),
          desiredOutcome,
          evidenceRefs: [
            {
              sourceType: "manual",
              recordId: "gtm-call-workspace-ui",
              excerpt: objective,
              retrievedAt: new Date().toISOString(),
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error("call prep failed");
      }
      const body = (await response.json()) as CreateGtmCallPrepResult;
      setPrep(body);
      toast.success("Call prep created");
    } catch {
      toast.error("Failed to create call prep");
    } finally {
      setPreparing(false);
    }
  }

  async function createDebrief() {
    setDebriefing(true);
    try {
      const response = await fetch("/api/gtm/calls/debrief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId: prep?.callId ?? null,
          notes,
          attendees: splitLines(attendees),
          evidenceRefs: [
            {
              sourceType: "call",
              recordId: prep?.callId ?? "manual-call-notes",
              excerpt: notes.slice(0, 180),
              retrievedAt: new Date().toISOString(),
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error("call debrief failed");
      }
      const body = (await response.json()) as CreateGtmCallDebriefResult;
      setDebrief(body);
      toast.success("Call debrief created");
    } catch {
      toast.error("Failed to create call debrief");
    } finally {
      setDebriefing(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Prep</h2>
          </div>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gtm-call-objective">Founder objective</Label>
              <Textarea
                id="gtm-call-objective"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gtm-call-context">Known context</Label>
              <Textarea
                id="gtm-call-context"
                value={knownContext}
                onChange={(event) => setKnownContext(event.target.value)}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gtm-call-open-loops">Open loops</Label>
              <Textarea
                id="gtm-call-open-loops"
                value={openLoops}
                onChange={(event) => setOpenLoops(event.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gtm-call-outcome">Desired outcome</Label>
              <Input
                id="gtm-call-outcome"
                value={desiredOutcome}
                onChange={(event) => setDesiredOutcome(event.target.value)}
              />
            </div>
            <Button onClick={createPrep} disabled={preparing}>
              {preparing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Create prep
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Debrief</h2>
          </div>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gtm-call-attendees">Attendees</Label>
              <Textarea
                id="gtm-call-attendees"
                value={attendees}
                onChange={(event) => setAttendees(event.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gtm-call-notes">Notes or transcript</Label>
              <Textarea
                id="gtm-call-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={9}
              />
            </div>
            <Button onClick={createDebrief} disabled={debriefing}>
              {debriefing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Create debrief
            </Button>
          </div>
        </div>
      </section>

      {prep ? <CallPrepResult result={prep} /> : null}
      {debrief ? <CallDebriefResult result={debrief} /> : null}
    </div>
  );
}
