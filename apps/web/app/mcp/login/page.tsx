import type { Metadata } from "next";
import { loadRegisteredMcpClient } from "@/lib/auth/mcp-consent-record";
import { SignInButton } from "@/components/auth/sign-in-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Connect MCP client",
  description: "Sign in to authorize an MCP client to access your sessions.",
};

type McpLoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// better-auth's MCP OAuth authorize endpoint redirects an unauthenticated
// request here as `${loginPage}?${originalQueryString}` (see
// better-auth/dist/plugins/mcp/authorize.mjs) — this page's own
// `searchParams` ARE that original authorize request's query params
// (client_id, redirect_uri, response_type, scope, state, code_challenge,
// ...). After sign-in we replay the exact same query string against the
// real authorize endpoint, which now succeeds because a session exists.
export default async function McpLoginPage({
  searchParams,
}: McpLoginPageProps) {
  const resolved = await searchParams;
  const clientId =
    typeof resolved.client_id === "string" ? resolved.client_id : null;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string") {
      params.set(key, value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, entry);
      }
    }
  }
  const queryString = params.toString();

  if (!(clientId && queryString)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-foreground">
        <p
          role="alert"
          className="max-w-sm text-center text-sm text-destructive"
        >
          This sign-in link is missing required parameters. Ask the MCP client
          to restart the connection.
        </p>
      </div>
    );
  }

  const authorizeUrl = `/api/auth/mcp/authorize?${queryString}`;

  // Never echo `client_id` back to the page. At this point it is unverified
  // text from the URL, so rendering it verbatim would let a crafted link put
  // arbitrary words on our own domain. Resolve it against the registered
  // client instead, and fall back to neutral copy when it does not resolve.
  const client = await loadRegisteredMcpClient(clientId);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-foreground">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Connect an MCP client</CardTitle>
          <CardDescription>
            {client ? (
              <>
                <span className="font-medium text-foreground">
                  {client.clientName}
                </span>
                {client.redirectHosts.length > 0 ? (
                  <span> ({client.redirectHosts.join(", ")})</span>
                ) : null}
                <span>
                  {" "}
                  is requesting access to your Open Agents sessions over MCP.
                </span>
              </>
            ) : (
              <span>
                An MCP client is requesting access to your Open Agents sessions.
                You will be asked to approve exactly what it can read after you
                sign in.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInButton callbackUrl={authorizeUrl} className="w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
