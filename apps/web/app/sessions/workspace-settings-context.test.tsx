import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  useWorkspaceSettings,
  WorkspaceSettingsProvider,
  type WorkspaceSettingsTarget,
} from "./workspace-settings-context";

const target: WorkspaceSettingsTarget = {
  owner: "dennisonbertram",
  repo: "fork-open-agents",
  label: "dennisonbertram/fork-open-agents",
};

function WorkspaceSettingsProbe() {
  const { target: currentTarget } = useWorkspaceSettings();

  return (
    <output>
      {currentTarget
        ? `${currentTarget.owner}/${currentTarget.repo}:${currentTarget.label}`
        : "closed"}
    </output>
  );
}

describe("workspace settings context", () => {
  test("exposes the active in-content workspace settings target", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSettingsProvider
        value={{
          target,
          openWorkspaceSettings: () => undefined,
          closeWorkspaceSettings: () => undefined,
        }}
      >
        <WorkspaceSettingsProbe />
      </WorkspaceSettingsProvider>,
    );

    expect(html).toContain(
      "dennisonbertram/fork-open-agents:dennisonbertram/fork-open-agents",
    );
  });

  test("requires a provider so sidebar and shell wiring fail loudly", () => {
    expect(() => renderToStaticMarkup(<WorkspaceSettingsProbe />)).toThrow(
      "useWorkspaceSettings must be used within a WorkspaceSettingsProvider",
    );
  });
});
