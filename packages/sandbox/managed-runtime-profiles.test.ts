import { describe, expect, test } from "bun:test";
import {
  getManagedRuntimeProfile,
  getManagedRuntimeSnapshotCommands,
  isManagedRuntimeProfileId,
  listManagedRuntimeProfiles,
  normalizeManagedRuntimeProfileId,
} from "./managed-runtime-profiles";

describe("managed runtime profiles", () => {
  test("default web profile scopes browser prerequisites to the profile", () => {
    const profile = getManagedRuntimeProfile("web-bun-agent-browser");
    const installAgentBrowser = profile.setupCommands.find(
      (command) => command.id === "install-agent-browser",
    );
    const verifyAgentBrowser = profile.verificationCommands.find(
      (command) => command.id === "verify-agent-browser",
    );

    expect(profile.version).toBe("2026-08-05.1");
    expect(profile.expectedTools).toEqual(["bun", "agent-browser"]);
    expect(profile.optionalTools).toEqual(["node", "npm"]);
    expect(installAgentBrowser?.command).toContain(
      "bun install -g agent-browser",
    );
    expect(installAgentBrowser?.command).toContain(
      'rm -f "$profile_bin_dir/agent-browser"',
    );
    expect(installAgentBrowser?.command).toContain(
      "agent-browser-$platform-$agent_browser_arch",
    );
    expect(installAgentBrowser?.command).toContain(
      "agent-browser install --with-deps",
    );
    expect(installAgentBrowser?.command).toContain('exec %s "$@"');
    expect(verifyAgentBrowser?.command).toContain(
      "agent-browser --help >/dev/null",
    );
    expect(verifyAgentBrowser?.command).toContain(
      'test -d "$HOME/.agent-browser/browsers"',
    );
  });

  test("lists and validates built-in managed runtime profiles", () => {
    expect(listManagedRuntimeProfiles().map((profile) => profile.id)).toContain(
      "web-bun-agent-browser",
    );
    expect(isManagedRuntimeProfileId("web-bun-agent-browser")).toBe(true);
    expect(isManagedRuntimeProfileId("unknown-profile")).toBe(false);
    expect(normalizeManagedRuntimeProfileId("unknown-profile")).toBe(
      "web-bun-agent-browser",
    );
  });

  test("#811 (D3): setupScript is removed from the profile contract — setupCommands is the one source of truth", () => {
    const profile = getManagedRuntimeProfile("web-bun-agent-browser");
    expect("setupScript" in profile).toBe(false);
  });

  test("#1109: install-agent-browser pins an explicit version instead of a bare package name", () => {
    const profile = getManagedRuntimeProfile("web-bun-agent-browser");
    const installAgentBrowser = profile.setupCommands.find(
      (command) => command.id === "install-agent-browser",
    );

    expect(installAgentBrowser?.command).toContain(
      "bun install -g agent-browser@0.33.2",
    );
    expect(installAgentBrowser?.command).not.toMatch(
      /bun install -g agent-browser\s*$/m,
    );
  });

  test("#1109: install-agent-browser chmods the resolved native binary instead of requiring it pre-executable", () => {
    const profile = getManagedRuntimeProfile("web-bun-agent-browser");
    const installAgentBrowser = profile.setupCommands.find(
      (command) => command.id === "install-agent-browser",
    );

    expect(installAgentBrowser?.command).toContain(
      'chmod +x "$agent_browser_path"',
    );
    expect(installAgentBrowser?.command).not.toContain(
      '[ ! -x "$agent_browser_path" ]',
    );
  });

  test("#1109: install-agent-browser still fails loudly when the binary is absent", () => {
    const profile = getManagedRuntimeProfile("web-bun-agent-browser");
    const installAgentBrowser = profile.setupCommands.find(
      (command) => command.id === "install-agent-browser",
    );

    expect(installAgentBrowser?.command).toContain(
      'if [ ! -f "$agent_browser_path" ]; then echo "agent-browser native binary was not found after install: $agent_browser_path" >&2; exit 1; fi',
    );
  });

  test("#811 (D3): snapshot commands derive from setupCommands, not a removed setupScript", () => {
    const profile = getManagedRuntimeProfile("web-bun-agent-browser");
    const snapshotCommands = getManagedRuntimeSnapshotCommands(profile);

    for (const setupCommand of profile.setupCommands) {
      expect(snapshotCommands).toContain(setupCommand.command);
    }
    for (const verificationCommand of profile.verificationCommands) {
      expect(snapshotCommands).toContain(verificationCommand.command);
    }
    expect(snapshotCommands).toHaveLength(
      profile.setupCommands.length + profile.verificationCommands.length,
    );
  });
});
