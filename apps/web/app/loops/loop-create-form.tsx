"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { validateLoopDefinition } from "@/lib/agent-loops/validation";
import type { LoopValidationError } from "@/lib/agent-loops/types";
import type {
  AgentLoopsReadinessResponse,
  CreateAgentLoopResponse,
} from "@/app/api/agent-loops/types";
import { RepoCombobox } from "./repo-combobox";
import { getRepoAllowlistBlockMessage } from "./repo-allowlist-precheck";
import type { LoopTemplateSuggestedTriggerSpec } from "./loop-templates";
import { appendSuggestedTriggerParams } from "./suggested-trigger-query";

// ── Types ─────────────────────────────────────────────────────────────────────

type LoopCreateFormProps = {
  /** Pre-populated validation errors (e.g. from a server 400 response) */
  initialValidationErrors?: LoopValidationError[];
  /** Pre-populate repo owner from query params (e.g. dashboard "New workflow" action) */
  initialRepoOwner?: string;
  /** Pre-populate repo name from query params (e.g. dashboard "New workflow" action) */
  initialRepoName?: string;
  /** Pre-populate the loop name (e.g. from a chosen template or AI draft) */
  initialName?: string;
  /** Pre-populate the description (e.g. from a chosen template or AI draft) */
  initialDescription?: string;
  /** Pre-populate the definition JSON (e.g. from a chosen template or AI draft) */
  initialDefinitionText?: string;
  /** Where to send the user after a successful create. Defaults to the detail page. */
  redirectTo?: "detail" | "builder";
  /**
   * When true (template / AI flows), the JSON definition editor is tucked
   * behind an "Advanced" disclosure so first-timers aren't confronted with raw
   * JSON. It auto-opens if the definition has errors.
   */
  definitionCollapsible?: boolean;
  /**
   * The chosen template's machine-readable trigger suggestion (#765), when
   * present. Carried through to the post-create landing page as a query
   * param so the "Attach suggested trigger" nudge can read it back — creating
   * the loop never auto-attaches a trigger by itself.
   */
  suggestedTriggerSpec?: LoopTemplateSuggestedTriggerSpec;
};

// ── Validation error display ──────────────────────────────────────────────────

function ValidationErrorList({ errors }: { errors: LoopValidationError[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 rounded-md border border-red-500/25 bg-red-500/10 p-3">
      {errors.map((err, i) => (
        <li key={i} className="text-xs">
          <span className="font-mono text-red-700 dark:text-red-300">
            {err.rule}
          </span>
          <span className="ml-2 text-muted-foreground">{err.message}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Definition JSON editor ────────────────────────────────────────────────────

const DEFAULT_DEFINITION = JSON.stringify(
  {
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      { id: "end", kind: "end", label: "End", position: { x: 200, y: 0 } },
    ],
    edges: [{ id: "e1", source: "start", target: "end", when: "always" }],
  },
  null,
  2,
);

// ── Main component ─────────────────────────────────────────────────────────────

export function LoopCreateForm({
  initialValidationErrors,
  initialRepoOwner,
  initialRepoName,
  initialName,
  initialDescription,
  initialDefinitionText,
  redirectTo = "detail",
  definitionCollapsible = false,
  suggestedTriggerSpec,
}: LoopCreateFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName ?? "");
  const [repoOwner, setRepoOwner] = useState(initialRepoOwner ?? "");
  const [repoName, setRepoName] = useState(initialRepoName ?? "");
  const [description, setDescription] = useState(initialDescription ?? "");
  const [definitionText, setDefinitionText] = useState(
    initialDefinitionText ?? DEFAULT_DEFINITION,
  );
  const [validationErrors, setValidationErrors] = useState<
    LoopValidationError[]
  >(initialValidationErrors ?? []);
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // When the form is opened from a specific repository (its owner+name are
  // pre-supplied), the loop belongs to that repo — show it fixed rather than as
  // a changeable picker. The picker only appears for a general "New loop".
  const repoLocked = Boolean(initialRepoOwner && initialRepoName);

  // Validate on blur — client mirrors server validation, server is authoritative
  function handleDefinitionBlur() {
    setJsonParseError(null);
    setValidationErrors([]);

    let parsed: unknown;
    try {
      parsed = JSON.parse(definitionText);
    } catch {
      setJsonParseError("Invalid JSON — please check your definition.");
      return;
    }

    const result = validateLoopDefinition(parsed);
    if (!result.ok) {
      setValidationErrors(result.errors);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setJsonParseError(null);
    setValidationErrors([]);

    if (!repoOwner || !repoName) {
      toast.error("Pick a repository (owner/repo) for this loop.");
      return;
    }

    // Allowlist precheck (#767) — ask before submit so the user sees a
    // plain-language message instead of a first-run 403.
    try {
      const readinessRes = await fetch(
        `/api/agent-loops/readiness?owner=${encodeURIComponent(repoOwner)}&repo=${encodeURIComponent(repoName)}`,
      );
      if (readinessRes.ok) {
        const readiness =
          (await readinessRes.json()) as AgentLoopsReadinessResponse;
        const blockMessage = getRepoAllowlistBlockMessage(readiness);
        if (blockMessage) {
          toast.error(blockMessage);
          return;
        }
      }
    } catch {
      // Precheck is best-effort — if it fails, fall through to the real
      // create request, which enforces the allowlist authoritatively.
    }

    let definition: unknown;
    try {
      definition = JSON.parse(definitionText);
    } catch {
      setJsonParseError(
        "Invalid JSON — please fix the definition before saving.",
      );
      return;
    }

    // Client-side pre-validation
    const clientResult = validateLoopDefinition(definition);
    if (!clientResult.ok) {
      setValidationErrors(clientResult.errors);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/agent-loops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || undefined,
          repoOwner,
          repoName,
          definition,
        }),
      });

      if (res.status === 400) {
        const body = (await res.json()) as {
          errors?: LoopValidationError[];
          message?: string;
        };
        if (body.errors) {
          setValidationErrors(body.errors);
          return;
        }
        toast.error(body.message ?? "Invalid loop definition.");
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        toast.error(body.message ?? "Failed to create loop.");
        return;
      }

      const { loop } = (await res.json()) as CreateAgentLoopResponse;
      toast.success(`Loop "${loop.name}" created.`);
      const basePath =
        redirectTo === "builder"
          ? `/loops/${loop.id}/builder`
          : `/loops/${loop.id}`;
      router.push(appendSuggestedTriggerParams(basePath, suggestedTriggerSpec));
    } catch {
      toast.error("Failed to create loop. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* name */}
      <div className="space-y-2">
        <Label htmlFor="loop-name">Name</Label>
        <Input
          id="loop-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My loop"
          required
        />
      </div>

      {/* Repo */}
      <div className="space-y-2">
        <Label htmlFor="repo">Repository</Label>
        {repoLocked ? (
          <div className="flex items-center rounded-md border border-input bg-muted/30 px-3 py-2 font-mono text-sm text-muted-foreground">
            {repoOwner}/{repoName}
          </div>
        ) : (
          <RepoCombobox
            owner={repoOwner}
            name={repoName}
            onChange={(o, n) => {
              setRepoOwner(o);
              setRepoName(n);
            }}
          />
        )}
        <p className="text-xs text-muted-foreground">
          {repoLocked
            ? "This loop runs against this repository."
            : "The GitHub repository this loop runs against. Pick one you've used before, or type any owner/repo."}
        </p>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what this loop does"
        />
      </div>

      {/* definition JSON editor */}
      {(() => {
        const hasDefinitionError =
          validationErrors.length > 0 || jsonParseError !== null;
        const editor = (
          <>
            <Textarea
              id="definition"
              value={definitionText}
              onChange={(e) => setDefinitionText(e.target.value)}
              onBlur={handleDefinitionBlur}
              className="min-h-48 font-mono text-xs"
              spellCheck={false}
              aria-label="Loop definition JSON"
            />
            {jsonParseError && (
              <p className="text-xs text-red-700 dark:text-red-300">
                {jsonParseError}
              </p>
            )}
            <ValidationErrorList errors={validationErrors} />
          </>
        );

        if (definitionCollapsible) {
          return (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                You don&apos;t need to edit anything here — pick a repository
                and create. You&apos;ll fine-tune each step visually in the
                builder.
              </p>
              <details
                open={hasDefinitionError || undefined}
                className="rounded-md border border-border bg-muted/10 px-3 py-2"
              >
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                  Advanced — edit the loop definition (JSON)
                </summary>
                <div className="mt-3 space-y-2">{editor}</div>
              </details>
            </div>
          );
        }

        return (
          <div className="space-y-2">
            <Label htmlFor="definition">Loop definition (JSON)</Label>
            <p className="text-xs text-muted-foreground">
              Paste or edit the loop definition JSON. Errors are validated on
              blur before saving.
            </p>
            {editor}
          </div>
        );
      })()}

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create loop"}
        </Button>
      </div>
    </form>
  );
}
