/**
 * Dev-preview: renders RepoSettingsSection with mock props.
 * No auth, no DB, no fetch — safe to view without login.
 * Lets reviewers see all five sections including inherited-vs-overridden states.
 */
import { SettingsPageHeader } from "@/components/ui/settings-section";
import { RepoSettingsSection } from "@/app/settings/repositories/[owner]/[repo]/repo-settings-section";
import type { RepoSettingsSectionProps } from "@/app/settings/repositories/[owner]/[repo]/repo-settings-section";

/** Mock: fullClone and autoCommitPush are overridden; rest are inherited. */
const MOCK_RAW: RepoSettingsSectionProps["raw"] = {
  fullClone: true,
  prewarmEnabled: null,
  runtimeMode: null,
  managedRuntimeProfileId: null,
  vcpus: null,
  autoCommitPush: true,
  autoCreatePr: null,
  defaultBranch: null,
  isNewBranch: null,
};

/** Resolved = what's effective after collapsing all layers. */
const MOCK_RESOLVED: RepoSettingsSectionProps["resolved"] = {
  fullClone: true,
  prewarmEnabled: false,
  runtimeMode: "classic",
  managedRuntimeProfileId: "web-bun-agent-browser",
  vcpus: 1,
  autoCommitPush: true,
  autoCreatePr: false,
  defaultBranch: null,
  isNewBranch: false,
};

const MOCK_INTEGRATIONS: RepoSettingsSectionProps["integrations"] = {
  github: {
    status: "connected",
    reason: null,
    hasInstallations: true,
    syncedInstallationsCount: 2,
  },
  vercel: {
    projectId: "prj_mock123",
    projectName: "acme-web",
    teamId: null,
    teamSlug: "acme",
  },
  composioHref: "/settings/composio",
};

export default function DevPreviewRepoSettings() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <SettingsPageHeader
        title="acme/web"
        description="[Dev preview] Per-repository defaults — no login required."
      />
      <RepoSettingsSection
        owner="acme"
        repo="web"
        resolved={MOCK_RESOLVED}
        raw={MOCK_RAW}
        integrations={MOCK_INTEGRATIONS}
        onSave={async (patch) => {
          // Dev-preview stub: just log, no network request
          console.log("[dev-preview] onSave called with patch:", patch);
        }}
        onReset={async () => {
          console.log("[dev-preview] onReset called");
        }}
      />
    </div>
  );
}
