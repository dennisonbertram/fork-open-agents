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

    expect(profile.version).toBe("2026-08-05.2");
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

  test("D1: install-agent-browser does not unconditionally rm -rf the installed package", () => {
    const profile = getManagedRuntimeProfile("web-bun-agent-browser");
    const installAgentBrowser = profile.setupCommands.find(
      (command) => command.id === "install-agent-browser",
    );

    expect(installAgentBrowser?.command).not.toMatch(
      /^rm -rf "\$HOME\/\.bun\/install\/global\/node_modules\/agent-browser"$/m,
    );
  });

  test("D1: install-agent-browser skips reinstall only when the pinned version AND the native binary are already present", () => {
    const profile = getManagedRuntimeProfile("web-bun-agent-browser");
    const installAgentBrowser = profile.setupCommands.find(
      (command) => command.id === "install-agent-browser",
    );
    const command = installAgentBrowser?.command ?? "";

    // Skip branch must gate on both the pinned version match and the native
    // binary already existing on disk — neither alone is a safe skip.
    expect(command).toMatch(
      /agent_browser_installed_version.*=.*agent_browser_pinned_version.*&&.*-f "\$agent_browser_path"/,
    );
  });

  test("D1: install-agent-browser still installs the pinned version on a bare machine", () => {
    const profile = getManagedRuntimeProfile("web-bun-agent-browser");
    const installAgentBrowser = profile.setupCommands.find(
      (command) => command.id === "install-agent-browser",
    );

    expect(installAgentBrowser?.command).toMatch(
      /bun install -g agent-browser@\S+/,
    );
  });

  test("D1: chmod and the profile shim write happen unconditionally, regardless of which branch ran", () => {
    const profile = getManagedRuntimeProfile("web-bun-agent-browser");
    const installAgentBrowser = profile.setupCommands.find(
      (command) => command.id === "install-agent-browser",
    );
    const command = installAgentBrowser?.command ?? "";
    const lines = command.split("\n");

    // The chmod and shim-write lines must appear exactly once each, after
    // the if/else install block closes (fi), so both branches converge on
    // the same postcondition.
    const fiIndex = lines.findIndex((line) => line.trim() === "fi");
    const chmodIndex = lines.findIndex((line) =>
      line.includes('chmod +x "$agent_browser_path"'),
    );
    const shimWriteIndex = lines.findIndex((line) =>
      line.includes('> "$profile_bin_dir/agent-browser"'),
    );

    expect(fiIndex).toBeGreaterThan(-1);
    expect(chmodIndex).toBeGreaterThan(fiIndex);
    expect(shimWriteIndex).toBeGreaterThan(fiIndex);
    expect(command.match(/chmod \+x "\$agent_browser_path"/g)?.length).toBe(1);
    expect(command.match(/> "\$profile_bin_dir\/agent-browser"/g)?.length).toBe(
      1,
    );
  });

  test("#811 (D3): setupScript is removed from the profile contract — setupCommands is the one source of truth", () => {
    const profile = getManagedRuntimeProfile("web-bun-agent-browser");
    expect("setupScript" in profile).toBe(false);
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
