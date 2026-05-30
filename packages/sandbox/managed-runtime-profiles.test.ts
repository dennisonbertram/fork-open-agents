import { describe, expect, test } from "bun:test";
import {
  getManagedRuntimeProfile,
  getManagedRuntimeSnapshotCommands,
  isManagedRuntimeProfileId,
  listManagedRuntimeProfiles,
  normalizeManagedRuntimeProfileId,
} from "./managed-runtime-profiles";
import type { ManagedRuntimeProfile } from "./managed-runtime-profiles";

describe("managed runtime profiles", () => {
  test("default web profile scopes browser prerequisites to the profile", () => {
    const profile = getManagedRuntimeProfile("web-bun-agent-browser");
    const installAgentBrowser = profile.setupCommands.find(
      (command) => command.id === "install-agent-browser",
    );
    const verifyAgentBrowser = profile.verificationCommands.find(
      (command) => command.id === "verify-agent-browser",
    );

    expect(profile.version).toBe("2026-05-23.2");
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

  // Test 4: getManagedRuntimeSnapshotCommands includes setupScript command
  describe("getManagedRuntimeSnapshotCommands", () => {
    test("includes the setupScript command when the profile has a setupScript", () => {
      const profile: ManagedRuntimeProfile = {
        id: "test-profile",
        version: "1.0.0",
        displayName: "Test Profile",
        description: "Test",
        setupScript: {
          repoPath: "profiles/test/setup.sh",
          sandboxPath: "/tmp/test/setup.sh",
          command: "bash /tmp/test/setup.sh",
          timeoutMs: 60_000,
        },
        setupCommands: [
          {
            id: "install-foo",
            label: "Install foo",
            description: "Install foo",
            command: "curl -fsSL https://example.com | bash",
          },
        ],
        verificationCommands: [
          {
            id: "verify-foo",
            label: "Verify foo",
            description: "Checks foo",
            command: "foo --version",
            required: true,
          },
        ],
        expectedTools: ["foo"],
        optionalTools: [],
        defaultPorts: [3000],
      };

      const commands = getManagedRuntimeSnapshotCommands(profile);

      // When setupScript is present it replaces individual setupCommands in the snapshot list
      expect(commands).toContain("bash /tmp/test/setup.sh");
      // Individual setup commands must NOT be included when setupScript is present
      expect(commands).not.toContain("curl -fsSL https://example.com | bash");
      // Verification commands are always included
      expect(commands).toContain("foo --version");
    });

    test("falls back to individual setupCommands when setupScript is absent", () => {
      const profile: ManagedRuntimeProfile = {
        id: "test-profile-no-script",
        version: "1.0.0",
        displayName: "No-script Profile",
        description: "Test",
        setupCommands: [
          {
            id: "install-bar",
            label: "Install bar",
            description: "Install bar",
            command: "curl -fsSL https://example.com/bar | bash",
          },
        ],
        verificationCommands: [
          {
            id: "verify-bar",
            label: "Verify bar",
            description: "Checks bar",
            command: "bar --version",
            required: true,
          },
        ],
        expectedTools: ["bar"],
        optionalTools: [],
        defaultPorts: [3000],
      };

      const commands = getManagedRuntimeSnapshotCommands(profile);

      expect(commands).toContain("curl -fsSL https://example.com/bar | bash");
      expect(commands).toContain("bar --version");
    });

    test("default web profile includes setupScript command in snapshot commands", () => {
      const profile = getManagedRuntimeProfile("web-bun-agent-browser");
      const commands = getManagedRuntimeSnapshotCommands(profile);

      expect(profile.setupScript).toBeDefined();
      expect(commands).toContain(profile.setupScript!.command);
      // Individual setup commands should not appear since setupScript is set
      for (const cmd of profile.setupCommands) {
        expect(commands).not.toContain(cmd.command);
      }
    });
  });
});
