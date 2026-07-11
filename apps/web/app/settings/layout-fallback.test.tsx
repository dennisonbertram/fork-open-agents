import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function Stub() {
  return createElement("div");
}

mock.module("next/navigation", () => ({
  redirect: () => undefined,
  usePathname: () => "/settings/background-agents",
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("@/hooks/use-session", () => ({
  useSession: () => ({
    loading: true,
    isAuthenticated: false,
    isAdmin: false,
  }),
}));
mock.module("@/lib/auth/actions", () => ({ signOut: () => undefined }));
mock.module("@/components/auth/auth-guard", () => ({
  AuthGuard: ({ loadingFallback }: { loadingFallback: unknown }) =>
    loadingFallback,
}));
mock.module("@/components/ui/sheet", () => ({
  Sheet: Stub,
  SheetContent: Stub,
  SheetHeader: Stub,
  SheetTitle: Stub,
}));
mock.module("@/components/ui/skeleton", () => ({ Skeleton: Stub }));
mock.module("./accounts-section", () => ({ AccountsSectionSkeleton: Stub }));
mock.module("./agents/agents-section", () => ({ AgentsSectionSkeleton: Stub }));
mock.module("./composio-section", () => ({ ComposioSectionSkeleton: Stub }));
mock.module("./inference-profiles-section", () => ({
  InferenceProfilesSectionSkeleton: Stub,
}));
mock.module("./leaderboard-section", () => ({
  LeaderboardSectionSkeleton: Stub,
}));
mock.module("./model-variants-section", () => ({
  ModelVariantsSectionSkeleton: Stub,
}));
mock.module("./preferences-section", () => ({
  PreferencesSectionSkeleton: Stub,
}));
mock.module("./skills/skills-section", () => ({ SkillsSectionSkeleton: Stub }));
mock.module("./settings-nav", () => ({ SettingsNav: Stub }));

const layoutModulePromise = import("./layout");

describe("Settings layout fallback metadata", () => {
  test("prerenders the legacy Background agents route while Automations owns nav state", async () => {
    const { default: SettingsLayout } = await layoutModulePromise;

    const html = renderToStaticMarkup(
      <SettingsLayout>settings-content</SettingsLayout>,
    );

    expect(html).toContain("Background agents");
    expect(html).toContain("Automations");
  });
});
