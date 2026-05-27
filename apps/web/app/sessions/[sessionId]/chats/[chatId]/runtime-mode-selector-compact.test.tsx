import { describe, expect, test } from "bun:test";
import type { ManagedRuntimeProfileOption } from "@/app/api/sessions/[sessionId]/managed-runtime/profiles/route";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RuntimeModeSelectorCompact,
  getRuntimeModeSummary,
} from "./runtime-mode-selector-compact";

const profile: ManagedRuntimeProfileOption = {
  id: "web-bun-agent-browser",
  version: "2026-05-23.2",
  displayName: "Web app with Bun and browser checks",
  description: "Built-in web profile",
  setupCommandCount: 2,
  verificationCommandCount: 2,
  expectedTools: ["bun", "agent-browser"],
  optionalTools: ["node"],
  defaultPorts: [3000],
  source: "built_in",
  testedAt: null,
};

describe("getRuntimeModeSummary", () => {
  test("explains the coordinator and managed worker path before sending", () => {
    const summary = getRuntimeModeSummary({
      runtimeMode: "managed_runtime",
      profile,
    });

    expect(summary).toContain("Coordinator");
    expect(summary).toContain("delegates repo work to managed workers");
    expect(summary).toContain("Runtime Inspector");
    expect(summary).toContain("incomplete proof");
  });

  test("keeps classic mode explicit as direct work", () => {
    const summary = getRuntimeModeSummary({
      runtimeMode: "classic",
      profile,
    });

    expect(summary).toContain("top-level agent can work directly");
    expect(summary).toContain("Switch to managed runtime");
  });
});

describe("RuntimeModeSelectorCompact", () => {
  test("renders managed mode as a visible composer control", () => {
    const html = renderToStaticMarkup(
      <RuntimeModeSelectorCompact
        managedRuntimeProfileId={profile.id}
        onManagedRuntimeProfileChange={() => {}}
        onRuntimeModeChange={() => {}}
        profiles={[profile]}
        runtimeMode="managed_runtime"
        selectedProfile={profile}
      />,
    );

    expect(html).toContain("Managed");
    expect(html).toContain("Coordinator");
    expect(html).toContain("managed workers");
  });
});
