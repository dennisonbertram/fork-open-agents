"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canonicalNewAutomationUrl } from "@/lib/automations/definition-routes";

export function parseAutomationRepository(value: string): {
  owner: string;
  name: string;
} | null {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  const separator = normalized.indexOf("/");
  if (separator <= 0 || separator === normalized.length - 1) return null;
  const owner = normalized.slice(0, separator).trim();
  const name = normalized.slice(separator + 1).trim();
  if (!(owner && name) || name.includes("/")) return null;
  return { owner, name };
}

export function AutomationRepositoryPicker() {
  const router = useRouter();
  const [repository, setRepository] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseAutomationRepository(repository);
    if (!parsed) {
      setError("Enter a repository as owner/name.");
      return;
    }
    setError(null);
    router.push(canonicalNewAutomationUrl(parsed));
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <div className="space-y-2">
        <Label htmlFor="automation-repository">Repository</Label>
        <Input
          id="automation-repository"
          value={repository}
          onChange={(event) => setRepository(event.target.value)}
          placeholder="owner/repository"
          aria-describedby={error ? "automation-repository-error" : undefined}
          aria-invalid={error ? true : undefined}
        />
        <p className="text-pretty text-xs text-muted-foreground">
          Choose the GitHub repository this Automation will observe and modify
          according to its configured permissions.
        </p>
        {error ? (
          <p
            id="automation-repository-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit">Continue</Button>
    </form>
  );
}
