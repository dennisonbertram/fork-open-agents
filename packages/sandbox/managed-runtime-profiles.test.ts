import { describe, expect, test } from "bun:test";
import {
  getManagedRuntimeProfile,
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

  // BT-001: python-uv profile is registered, resolvable, and has valid shape
  describe("python-uv profile", () => {
    test("is listed and resolvable by id", () => {
      const ids = listManagedRuntimeProfiles().map((p) => p.id);
      expect(ids).toContain("python-uv");
      expect(isManagedRuntimeProfileId("python-uv")).toBe(true);
    });

    test("has required shape fields: version, displayName, description, expectedTools", () => {
      const profile = getManagedRuntimeProfile("python-uv");
      expect(typeof profile.version).toBe("string");
      expect(profile.version.length).toBeGreaterThan(0);
      expect(typeof profile.displayName).toBe("string");
      expect(typeof profile.description).toBe("string");
      expect(Array.isArray(profile.expectedTools)).toBe(true);
      expect(profile.expectedTools.length).toBeGreaterThan(0);
    });

    test("includes uv and python in expectedTools", () => {
      const profile = getManagedRuntimeProfile("python-uv");
      expect(profile.expectedTools).toContain("uv");
      expect(profile.expectedTools).toContain("python");
    });

    test("has setup commands referencing uv install", () => {
      const profile = getManagedRuntimeProfile("python-uv");
      expect(profile.setupCommands.length).toBeGreaterThan(0);
      const installCmd = profile.setupCommands[0];
      expect(installCmd.command).toContain("uv");
      expect(installCmd.command).toContain("set -e");
    });

    test("has required verification commands for uv and python", () => {
      const profile = getManagedRuntimeProfile("python-uv");
      const verifyUv = profile.verificationCommands.find(
        (c) => c.id === "verify-uv",
      );
      const verifyPython = profile.verificationCommands.find(
        (c) => c.id === "verify-python",
      );
      expect(verifyUv).toBeDefined();
      expect(verifyUv?.required).toBe(true);
      expect(verifyPython).toBeDefined();
      expect(verifyPython?.required).toBe(true);
    });
  });

  // BT-002: go-toolchain profile is registered, resolvable, and has valid shape
  describe("go-toolchain profile", () => {
    test("is listed and resolvable by id", () => {
      const ids = listManagedRuntimeProfiles().map((p) => p.id);
      expect(ids).toContain("go-toolchain");
      expect(isManagedRuntimeProfileId("go-toolchain")).toBe(true);
    });

    test("has required shape fields: version, displayName, description, expectedTools", () => {
      const profile = getManagedRuntimeProfile("go-toolchain");
      expect(typeof profile.version).toBe("string");
      expect(profile.version.length).toBeGreaterThan(0);
      expect(typeof profile.displayName).toBe("string");
      expect(typeof profile.description).toBe("string");
      expect(Array.isArray(profile.expectedTools)).toBe(true);
      expect(profile.expectedTools.length).toBeGreaterThan(0);
    });

    test("includes go in expectedTools", () => {
      const profile = getManagedRuntimeProfile("go-toolchain");
      expect(profile.expectedTools).toContain("go");
    });

    test("has required verification commands for go", () => {
      const profile = getManagedRuntimeProfile("go-toolchain");
      const verifyGo = profile.verificationCommands.find(
        (c) => c.id === "verify-go",
      );
      expect(verifyGo).toBeDefined();
      expect(verifyGo?.required).toBe(true);
    });
  });

  // BT-003: rust-cargo profile is registered, resolvable, and has valid shape
  describe("rust-cargo profile", () => {
    test("is listed and resolvable by id", () => {
      const ids = listManagedRuntimeProfiles().map((p) => p.id);
      expect(ids).toContain("rust-cargo");
      expect(isManagedRuntimeProfileId("rust-cargo")).toBe(true);
    });

    test("has required shape fields: version, displayName, description, expectedTools", () => {
      const profile = getManagedRuntimeProfile("rust-cargo");
      expect(typeof profile.version).toBe("string");
      expect(profile.version.length).toBeGreaterThan(0);
      expect(typeof profile.displayName).toBe("string");
      expect(typeof profile.description).toBe("string");
      expect(Array.isArray(profile.expectedTools)).toBe(true);
      expect(profile.expectedTools.length).toBeGreaterThan(0);
    });

    test("includes rustc and cargo in expectedTools", () => {
      const profile = getManagedRuntimeProfile("rust-cargo");
      expect(profile.expectedTools).toContain("rustc");
      expect(profile.expectedTools).toContain("cargo");
    });

    // BT-003a: rust-cargo verify-linker is required:true (critical constraint)
    test("has a required verify-linker verification command", () => {
      const profile = getManagedRuntimeProfile("rust-cargo");
      const verifyLinker = profile.verificationCommands.find(
        (c) => c.id === "verify-linker",
      );
      expect(verifyLinker).toBeDefined();
      expect(verifyLinker?.required).toBe(true);
      expect(verifyLinker?.command).toContain("command -v cc");
    });
  });

  // BT-004: docker-in-sandbox profile is registered, resolvable, and has valid shape
  describe("docker-in-sandbox profile", () => {
    test("is listed and resolvable by id", () => {
      const ids = listManagedRuntimeProfiles().map((p) => p.id);
      expect(ids).toContain("docker-in-sandbox");
      expect(isManagedRuntimeProfileId("docker-in-sandbox")).toBe(true);
    });

    test("has required shape fields: version, displayName, description, expectedTools", () => {
      const profile = getManagedRuntimeProfile("docker-in-sandbox");
      expect(typeof profile.version).toBe("string");
      expect(profile.version.length).toBeGreaterThan(0);
      expect(typeof profile.displayName).toBe("string");
      expect(typeof profile.description).toBe("string");
      expect(Array.isArray(profile.expectedTools)).toBe(true);
      expect(profile.expectedTools.length).toBeGreaterThan(0);
    });

    test("includes docker in expectedTools", () => {
      const profile = getManagedRuntimeProfile("docker-in-sandbox");
      expect(profile.expectedTools).toContain("docker");
    });

    // BT-004a: docker-in-sandbox verify-docker-daemon is required:true (wrong-tier signal)
    test("has a required verify-docker-daemon verification command", () => {
      const profile = getManagedRuntimeProfile("docker-in-sandbox");
      const verifyDaemon = profile.verificationCommands.find(
        (c) => c.id === "verify-docker-daemon",
      );
      expect(verifyDaemon).toBeDefined();
      expect(verifyDaemon?.required).toBe(true);
      expect(verifyDaemon?.command).toContain("docker info");
    });
  });

  test("all four new profile ids are unique and do not collide with default", () => {
    const ids = listManagedRuntimeProfiles().map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    expect(ids).toContain("web-bun-agent-browser");
    expect(ids).toContain("python-uv");
    expect(ids).toContain("go-toolchain");
    expect(ids).toContain("rust-cargo");
    expect(ids).toContain("docker-in-sandbox");
  });
});
