"use client";

import { ExternalLink, ThumbsDown, ThumbsUp } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  confidenceLabels,
  learningTypeLabels,
  type LearningFeedItem,
} from "./types";

function isSafeExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-pretty font-medium">{value}</dd>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  if (!children) {
    return null;
  }

  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="text-pretty text-sm text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export function LearningDetailSheet({
  learning,
  open,
  onOpenChange,
  onFeedback,
}: {
  learning: LearningFeedItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFeedback: (learningId: string, helpful: boolean) => void;
}) {
  if (!learning) {
    return null;
  }

  const evidenceCount = learning.evidence.length;
  const insightCount =
    learning.tags.length +
    learning.affectedPaths.length +
    (learning.prevention ? 1 : 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b border-border pb-4 pr-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{learningTypeLabels[learning.type]}</Badge>
            <Badge variant="outline">
              {confidenceLabels[learning.confidence]}
            </Badge>
          </div>
          <SheetTitle className="text-pretty text-xl">
            {learning.title}
          </SheetTitle>
          <SheetDescription className="text-pretty">
            AI-derived - confidence: {confidenceLabels[learning.confidence]},
            verify via evidence.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          <dl className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3">
            <DetailRow label="Type" value={learningTypeLabels[learning.type]} />
            <DetailRow label="Scope" value={learning.scope} />
            <DetailRow label="Severity" value={learning.severity} />
            <DetailRow
              label="Confidence"
              value={confidenceLabels[learning.confidence]}
            />
          </dl>

          <div className="space-y-4">
            <DetailSection title="Why">{learning.description}</DetailSection>
            {learning.rootCause ? (
              <DetailSection title="Root cause">
                {learning.rootCause}
              </DetailSection>
            ) : null}
            {learning.solution ? (
              <DetailSection title="Solution">
                {learning.solution}
              </DetailSection>
            ) : null}
            {learning.prevention ? (
              <DetailSection title="Prevention">
                {learning.prevention}
              </DetailSection>
            ) : null}
          </div>

          <Tabs defaultValue="evidence">
            <TabsList>
              <TabsTrigger value="evidence">
                Evidence ({evidenceCount})
              </TabsTrigger>
              <TabsTrigger value="insights">
                Insights ({insightCount})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="evidence" className="space-y-2">
              {learning.evidence.length > 0 ? (
                learning.evidence.map((evidence) => {
                  const safeUrl = isSafeExternalUrl(evidence.ref);
                  return (
                    <div
                      key={evidence.id}
                      className="rounded-lg border border-border bg-background p-3 text-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium capitalize">
                            {evidence.kind.replaceAll("_", " ")}
                          </p>
                          {evidence.excerpt ? (
                            <p className="mt-1 line-clamp-3 text-pretty text-muted-foreground">
                              {evidence.excerpt}
                            </p>
                          ) : null}
                        </div>
                        {safeUrl ? (
                          <a
                            href={evidence.ref}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            Open <ExternalLink className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
                      {!safeUrl ? (
                        <p className="mt-2 break-all text-xs text-muted-foreground">
                          {evidence.ref}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">
                  No evidence links were saved for this learning.
                </p>
              )}
            </TabsContent>
            <TabsContent value="insights" className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Affected paths</p>
                <div className="flex flex-wrap gap-1.5">
                  {learning.affectedPaths.length > 0 ? (
                    learning.affectedPaths.map((path) => (
                      <Badge
                        key={path}
                        variant="outline"
                        className="max-w-full truncate font-mono"
                      >
                        {path}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Repository-wide
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {learning.tags.length > 0 ? (
                    learning.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      No tags saved.
                    </span>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">
              Was this useful?
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onFeedback(learning.id, true)}
            >
              <ThumbsUp className="size-4" />
              Helpful
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onFeedback(learning.id, false)}
              className={cn("text-muted-foreground")}
            >
              <ThumbsDown className="size-4" />
              Not helpful
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
