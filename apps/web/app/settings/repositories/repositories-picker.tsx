"use client";

import { useRouter } from "next/navigation";
import { RepoSelector } from "@/components/repo-selector";

/**
 * Repo-picker landing page content for /settings/repositories (#805, epic
 * #796 T9). Reuses the existing RepoSelector (installations + repo search,
 * already used by the session-start flow) rather than a parallel repo
 * listing implementation — this component only adds navigation on
 * selection.
 *
 * NOTE — DOM-untestable: RepoSelector is effect-driven (fetches
 * installations/repos via useEffect + SWR-backed hooks) and this repo's
 * bun:test setup has no DOM environment, so useEffect never fires under
 * renderToStaticMarkup (same constraint documented in
 * composio-workspace-settings-panel.test.tsx). This component is
 * intentionally a thin, effect-free wrapper (just a callback + router push)
 * so the only meaningfully testable behavior — routing to the chosen
 * repo's Tools/settings page — is exercised via the authenticated local UI
 * smoke, not a unit test.
 */
export function RepositoriesPicker() {
  const router = useRouter();

  function handleRepoSelect(owner: string, repo: string) {
    router.push(
      `/settings/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Choose a repository to see its per-repository defaults and tool access.
      </p>
      <RepoSelector onRepoSelect={handleRepoSelect} />
    </div>
  );
}
