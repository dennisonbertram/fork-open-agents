"use client";

/**
 * loop-create-experience.tsx — the "New loop" on-ramp.
 *
 * Three ways to start, so a first-timer never faces a blank canvas:
 *   1. Start from a template (gallery of validated starter loops)
 *   2. Describe it in plain English (LLM drafts the graph)
 *   3. Blank / advanced JSON (the original form)
 *
 * Templates and AI prefill the shared LoopCreateForm and send the user straight
 * into the visual builder after create.
 */

import { useState } from "react";
import { ArrowLeft, ArrowRight, FileJson, Sparkles, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import { LoopCreateForm } from "./loop-create-form";
import {
  LOOP_TEMPLATES,
  type LoopTemplate,
  type LoopTemplateSuggestedTriggerSpec,
} from "./loop-templates";

type LoopCreateExperienceProps = {
  initialRepoOwner?: string;
  initialRepoName?: string;
};

type Prefill = {
  source: "template" | "ai";
  name: string;
  description: string;
  definition: LoopDefinition;
  suggestedTriggerSpec?: LoopTemplateSuggestedTriggerSpec;
};

/**
 * Builds a per-template accessible name for the "Use this template" button
 * (F-STORY-016-001). Sighted users still see the short "Use this template"
 * label; assistive tech gets the full "Use <name> template" name so several
 * identical-looking buttons in the gallery are distinguishable.
 */
export function getTemplateActionLabel(templateName: string): string {
  return `Use ${templateName} template`;
}

const AI_EXAMPLES = [
  "Every time there's a new PR, review the code and file any problems as GitHub issues.",
  "Take the top issue off the backlog, implement it, review it, and loop on fixes until it passes — then open a PR.",
  "Check my inbox; if a new email is a feature request, file it as an issue.",
];

// ── Tiny flow preview (node labels in authoring order) ──────────────────────────

function FlowPreview({ definition }: { definition: LoopDefinition }) {
  const labels = definition.nodes
    .filter((n) => n.kind !== "start" && n.kind !== "end")
    .map((n) => n.label);
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">
        Start
      </span>
      {labels.map((label) => (
        <span key={label} className="flex items-center gap-1">
          <ArrowRight className="h-3 w-3 opacity-50" />
          <span className="rounded bg-muted px-1.5 py-0.5">{label}</span>
        </span>
      ))}
      <ArrowRight className="h-3 w-3 opacity-50" />
      <span className="rounded bg-muted px-1.5 py-0.5">Done</span>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function LoopCreateExperience({
  initialRepoOwner,
  initialRepoName,
}: LoopCreateExperienceProps) {
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [aiDescription, setAiDescription] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  function chooseTemplate(template: LoopTemplate) {
    setPrefill({
      source: "template",
      name: template.name,
      description: template.description,
      definition: template.definition,
      suggestedTriggerSpec: template.suggestedTriggerSpec,
    });
  }

  async function generateFromDescription() {
    const description = aiDescription.trim();
    if (description.length < 8) {
      setAiError("Add a sentence or two describing what the loop should do.");
      return;
    }
    setAiError(null);
    setAiLoading(true);
    try {
      const res = await fetch("/api/agent-loops/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const body = (await res.json()) as {
        name?: string;
        description?: string;
        definition?: LoopDefinition;
        message?: string;
      };
      if (!res.ok || !body.definition) {
        setAiError(body.message ?? "Couldn't draft that loop. Try rephrasing.");
        return;
      }
      setPrefill({
        source: "ai",
        name: body.name ?? "Generated loop",
        description: body.description ?? description,
        definition: body.definition,
      });
    } catch {
      setAiError("Something went wrong drafting the loop. Try again.");
    } finally {
      setAiLoading(false);
    }
  }

  // ── Step 2: configure & create (prefilled from a template or AI) ──────────────
  if (prefill) {
    return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => setPrefill(null)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Choose a different starting point
        </button>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{prefill.name}</CardTitle>
              <Badge variant="secondary" className="text-xs">
                {prefill.source === "ai" ? "AI draft" : "Template"}
              </Badge>
            </div>
            <CardDescription>{prefill.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <FlowPreview definition={prefill.definition} />
            <p className="mt-3 text-xs text-muted-foreground">
              Pick the repository, then create — you&apos;ll land in the visual
              builder to tweak each step.
            </p>
          </CardContent>
        </Card>

        <LoopCreateForm
          key={`${prefill.source}-${prefill.name}`}
          initialRepoOwner={initialRepoOwner}
          initialRepoName={initialRepoName}
          initialName={prefill.name}
          initialDescription={prefill.description}
          initialDefinitionText={JSON.stringify(prefill.definition, null, 2)}
          redirectTo="builder"
          suggestedTriggerSpec={prefill.suggestedTriggerSpec}
          definitionCollapsible
        />
      </div>
    );
  }

  // ── Step 1: choose how to start ───────────────────────────────────────────────
  return (
    <Tabs defaultValue="template" className="space-y-5">
      <TabsList>
        <TabsTrigger value="template">
          <Sparkles className="mr-1.5 h-4 w-4" />
          Templates
        </TabsTrigger>
        <TabsTrigger value="ai">
          <Wand2 className="mr-1.5 h-4 w-4" />
          Describe with AI
        </TabsTrigger>
        <TabsTrigger value="blank">
          <FileJson className="mr-1.5 h-4 w-4" />
          Blank
        </TabsTrigger>
      </TabsList>

      {/* Templates */}
      <TabsContent value="template" className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Start from a working loop and adjust the steps.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {LOOP_TEMPLATES.map((template) => (
            <Card key={template.slug} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{template.name}</CardTitle>
                  {template.requiresTool ? (
                    <Badge variant="outline" className="text-[10px]">
                      Needs setup
                    </Badge>
                  ) : null}
                </div>
                <CardDescription>{template.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-3">
                <FlowPreview definition={template.definition} />
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Suggested trigger:
                  </span>{" "}
                  {template.suggestedTrigger}
                </p>
                {template.requiresTool ? (
                  <p className="text-xs text-muted-foreground">
                    Requires: {template.requiresTool}
                  </p>
                ) : null}
              </CardContent>
              <CardFooter>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => chooseTemplate(template)}
                  aria-label={getTemplateActionLabel(template.name)}
                >
                  Use this template
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </TabsContent>

      {/* Describe with AI */}
      <TabsContent value="ai" className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Describe what the loop should do. We&apos;ll draft the steps and
          branches — you review and edit before anything is saved.
        </p>
        <Textarea
          value={aiDescription}
          onChange={(e) => setAiDescription(e.target.value)}
          placeholder="e.g. Every time there's a new PR, review the code and file any problems as GitHub issues."
          className="min-h-28"
          aria-label="Describe your loop"
        />
        <div className="flex flex-wrap gap-2">
          {AI_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setAiDescription(example)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted/40"
            >
              {example.length > 52 ? `${example.slice(0, 52)}…` : example}
            </button>
          ))}
        </div>
        {aiError ? (
          <p className="text-xs text-red-700 dark:text-red-300">{aiError}</p>
        ) : null}
        <div className="space-y-2">
          <Button
            type="button"
            onClick={generateFromDescription}
            disabled={aiLoading}
          >
            <Wand2 className="mr-1.5 h-4 w-4" />
            {aiLoading ? "Drafting…" : "Generate loop"}
          </Button>
          {aiLoading ? (
            <p className="text-xs text-muted-foreground">
              Drafting your loop from your description — this usually takes
              10–20 seconds.
            </p>
          ) : null}
        </div>
      </TabsContent>

      {/* Blank / advanced */}
      <TabsContent value="blank" className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Author the loop definition directly as JSON.
        </p>
        <LoopCreateForm
          initialRepoOwner={initialRepoOwner}
          initialRepoName={initialRepoName}
          redirectTo="builder"
        />
      </TabsContent>
    </Tabs>
  );
}
