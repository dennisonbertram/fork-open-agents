"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GitHubRepositoryCombobox } from "@/components/github-repository-combobox";
import { Button } from "@/components/ui/button";
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
  const [repository, setRepository] = useState({ owner: "", name: "" });
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repository.owner || !repository.name) {
      setError("Choose a connected GitHub repository.");
      return;
    }
    setError(null);
    router.push(canonicalNewAutomationUrl(repository));
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <div className="space-y-2">
        <Label>Repository</Label>
        <GitHubRepositoryCombobox
          value={repository}
          onChange={(nextRepository) => {
            setRepository(nextRepository);
            setError(null);
          }}
          placeholder="Search connected repositories"
        />
        <p className="text-pretty text-xs text-muted-foreground">
          Search the GitHub repositories connected to your account. The
          Automation will observe and modify the selected repository according
          to its configured permissions.
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
