import { oAuthProtectedResourceMetadata } from "better-auth/plugins";
import { auth } from "@/lib/auth/config";

// OAuth 2.0 Protected Resource Metadata (RFC 9728), points MCP clients at
// the authorization server. No auth required.
export const GET = oAuthProtectedResourceMetadata(auth);
