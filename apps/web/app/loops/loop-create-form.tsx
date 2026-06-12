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
import type { CreateAgentLoopResponse } from "@/app/api/agent-loops/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type LoopCreateFormProps = {
  /** Pre-populated validation errors (e.g. from a server 400 response) */
  initialValidationErrors?: LoopValidationError[];
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
}: LoopCreateFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [repoOwner, setRepoOwner] = useState("");
  const [repoName, setRepoName] = useState("");
  const [description, setDescription] = useState("");
  const [definitionText, setDefinitionText] = useState(DEFAULT_DEFINITION);
  const [validationErrors, setValidationErrors] = useState<
    LoopValidationError[]
  >(initialValidationErrors ?? []);
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      router.push(`/loops/${loop.id}`);
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
        <Label htmlFor="loop-name">name</Label>
        <Input
          id="loop-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My loop"
          required
        />
      </div>

      {/* Repo */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="repo-owner">Repository owner</Label>
          <Input
            id="repo-owner"
            value={repoOwner}
            onChange={(e) => setRepoOwner(e.target.value)}
            placeholder="acme"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="repo-name">Repository name</Label>
          <Input
            id="repo-name"
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            placeholder="widgets"
            required
          />
        </div>
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
      <div className="space-y-2">
        <Label htmlFor="definition">Loop definition (JSON)</Label>
        <p className="text-xs text-muted-foreground">
          Paste or edit the loop definition JSON. Errors are validated on blur
          before saving.
        </p>
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
      </div>

      <div className="flex justify-end gap-3">
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
