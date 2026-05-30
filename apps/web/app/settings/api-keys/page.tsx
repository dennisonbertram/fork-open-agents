import type { Metadata } from "next";
import { ApiKeysSection } from "./section";

export const metadata: Metadata = {
  title: "API keys",
  description: "Manage machine credentials for Open Agents.",
};

export default function ApiKeysPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create scoped bearer tokens for the cloud agent runs API.
        </p>
      </div>
      <ApiKeysSection />
    </div>
  );
}
