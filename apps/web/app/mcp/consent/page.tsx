import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { loadPendingMcpConsent } from "@/lib/auth/mcp-consent-record";
import { getServerSession } from "@/lib/session/get-server-session";
import { McpConsentPanel } from "./mcp-consent-panel";

export const metadata: Metadata = {
  title: "Approve MCP client",
  description: "Review and approve an MCP client's access to your account.",
};

type McpConsentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function ConsentMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-foreground">
      <p role="alert" className="max-w-sm text-center text-sm text-destructive">
        {children}
      </p>
    </div>
  );
}

// better-auth's MCP authorize endpoint redirects here (after our
// forceMcpConsentPrompt hook forces prompt=consent on every request) as
// `${consentPage}?consent_code=...&client_id=...&scope=...`, with the
// consent code also stashed in a signed `oidc_consent_prompt` cookie. See
// better-auth/dist/plugins/mcp/authorize.mjs.
//
// The `client_id` and `scope` query params are attacker-controlled — they
// are never used to render this page. Only `consent_code` is used, purely
// as an opaque lookup key into our own database; client identity and scope
// come exclusively from the record that lookup returns.
export default async function McpConsentPage({
  searchParams,
}: McpConsentPageProps) {
  const resolved = await searchParams;
  const consentCode =
    typeof resolved.consent_code === "string" ? resolved.consent_code : null;

  if (!consentCode) {
    return (
      <ConsentMessage>
        This approval link is missing required parameters. Ask the MCP client to
        restart the connection.
      </ConsentMessage>
    );
  }

  const session = await getServerSession();
  if (!session) {
    return (
      <ConsentMessage>
        Sign in to your Open Agents account, then reopen this approval link.
      </ConsentMessage>
    );
  }

  const pending = await loadPendingMcpConsent(consentCode, session.user.id);
  if (pending.status !== "ready") {
    return (
      <ConsentMessage>
        This approval link is invalid or has expired. Ask the MCP client to
        restart the connection.
      </ConsentMessage>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-foreground">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Approve MCP client</CardTitle>
          <CardDescription>
            <span className="font-medium text-foreground">
              {pending.clientName}
            </span>{" "}
            ({pending.redirectHost}) is requesting the following access to your
            Open Agents account:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <McpConsentPanel
            clientName={pending.clientName}
            redirectHost={pending.redirectHost}
            consentCode={pending.consentCode}
            scopes={pending.scopes}
          />
        </CardContent>
      </Card>
    </div>
  );
}
