"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "sessions:read": "Read your sessions, chat previews, and diff summaries",
  "sessions:write":
    "Start and steer agent runs on your behalf. This runs code in a sandbox and consumes credits.",
  "agents:read": "Read your background agents and their runs",
  "agents:write": "Create and modify your background agents",
  "sandbox:exec": "Execute commands in your sandboxes",
};

function describeScope(scope: string): string {
  return SCOPE_DESCRIPTIONS[scope] ?? scope;
}

type McpConsentPanelProps = {
  clientName: string;
  redirectHost: string;
  consentCode: string;
  scopes: string[];
};

export function McpConsentPanel({
  clientName,
  redirectHost,
  consentCode,
  scopes,
}: McpConsentPanelProps) {
  const [status, setStatus] = useState<"idle" | "pending" | "error">("idle");

  async function respond(accept: boolean) {
    setStatus("pending");
    try {
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, consent_code: consentCode }),
      });
      if (!response.ok) {
        throw new Error(`Consent request failed with ${response.status}`);
      }
      const data = (await response.json()) as { redirectURI: string };
      window.location.href = data.redirectURI;
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <ul className="flex flex-col gap-2 rounded-md border border-border bg-muted/50 p-4 text-sm">
        {scopes.map((scope) => (
          <li key={scope}>{describeScope(scope)}</li>
        ))}
      </ul>
      {status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          Something went wrong approving this request. Please try again.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={status === "pending"}
          onClick={() => respond(true)}
        >
          {status === "pending" ? "Approving…" : "Approve"}
        </Button>
        <Button
          className="flex-1"
          disabled={status === "pending"}
          onClick={() => respond(false)}
          variant="outline"
        >
          Deny
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Requested by <span className="font-medium">{clientName}</span> (
        {redirectHost})
      </p>
    </div>
  );
}
