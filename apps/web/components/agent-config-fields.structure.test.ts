import { describe, expect, test } from "bun:test";

const sharedImport =
  'import { AgentConfigFields } from "@/components/agent-config-fields";';

describe("AgentConfigFields shared extraction", () => {
  test("settings agents and loop node config consume the shared component", async () => {
    const [settingsSource, loopSource, sharedSource] = await Promise.all([
      Bun.file(
        new URL("../app/settings/agents/agents-section.tsx", import.meta.url),
      ).text(),
      Bun.file(
        new URL(
          "../app/loops/[loopId]/builder/node-config-panel-component.tsx",
          import.meta.url,
        ),
      ).text(),
      Bun.file(new URL("agent-config-fields.tsx", import.meta.url)).text(),
    ]);

    expect(sharedSource).toContain("export function AgentConfigFields");

    for (const source of [settingsSource, loopSource]) {
      expect(source).toContain(sharedImport);
      expect(source).toContain("<AgentConfigFields");
      expect(source).not.toContain("ComposioToolkitPicker");
    }
  });
});
