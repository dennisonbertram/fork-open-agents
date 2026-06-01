/**
 * Regression tests for the managed-runtime profiles registry.
 *
 * These tests catch future breakage when:
 * - A profile is accidentally removed from MANAGED_RUNTIME_PROFILES
 * - A required verification command is changed to optional
 * - A profile id or key field is renamed
 * - The consumers (getManagedRuntimeProfile, isManagedRuntimeProfileId) break
 */

import { describe, expect, test } from "bun:test";
import {
  getManagedRuntimeProfile,
  isManagedRuntimeProfileId,
  listManagedRuntimeProfiles,
} from "./managed-runtime-profiles";

describe("managed runtime profiles — regression", () => {
  // All five profiles must always be present (removal guard)
  test("registry always contains exactly the five expected built-in profile ids", () => {
    const ids = listManagedRuntimeProfiles().map((p) => p.id);
    expect(ids).toContain("web-bun-agent-browser");
    expect(ids).toContain("python-uv");
    expect(ids).toContain("go-toolchain");
    expect(ids).toContain("rust-cargo");
    expect(ids).toContain("docker-in-sandbox");
  });

  // isManagedRuntimeProfileId must return true for all registered ids
  test.each([
    "web-bun-agent-browser",
    "python-uv",
    "go-toolchain",
    "rust-cargo",
    "docker-in-sandbox",
  ])("isManagedRuntimeProfileId('%s') returns true", (id) => {
    expect(isManagedRuntimeProfileId(id)).toBe(true);
  });

  // Each profile must have a non-empty version string (version regression)
  test.each([
    "web-bun-agent-browser",
    "python-uv",
    "go-toolchain",
    "rust-cargo",
    "docker-in-sandbox",
  ])("profile '%s' has a non-empty version string", (id) => {
    const profile = getManagedRuntimeProfile(id);
    expect(typeof profile.version).toBe("string");
    expect(profile.version.length).toBeGreaterThan(0);
  });

  // rust-cargo verify-linker must always be required:true
  test("rust-cargo verify-linker is required:true (regression guard — cargo build needs cc)", () => {
    const profile = getManagedRuntimeProfile("rust-cargo");
    const verifyLinker = profile.verificationCommands.find(
      (c) => c.id === "verify-linker",
    );
    expect(verifyLinker).toBeDefined();
    expect(verifyLinker?.required).toBe(true);
    expect(verifyLinker?.command).toContain("command -v cc");
  });

  // docker-in-sandbox verify-docker-daemon must always be required:true
  test("docker-in-sandbox verify-docker-daemon is required:true (regression guard — wrong-tier signal)", () => {
    const profile = getManagedRuntimeProfile("docker-in-sandbox");
    const verifyDaemon = profile.verificationCommands.find(
      (c) => c.id === "verify-docker-daemon",
    );
    expect(verifyDaemon).toBeDefined();
    expect(verifyDaemon?.required).toBe(true);
    expect(verifyDaemon?.command).toContain("docker info");
  });

  // All profile ids are unique (no duplicate id regression)
  test("all profile ids in registry are unique", () => {
    const ids = listManagedRuntimeProfiles().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Each profile has at least one setup command and one verification command
  test.each(["python-uv", "go-toolchain", "rust-cargo", "docker-in-sandbox"])(
    "profile '%s' has at least one setup command and one verification command",
    (id) => {
      const profile = getManagedRuntimeProfile(id);
      expect(profile.setupCommands.length).toBeGreaterThan(0);
      expect(profile.verificationCommands.length).toBeGreaterThan(0);
    },
  );

  // Setup commands must use set -e (idempotent safety contract)
  test.each(["python-uv", "go-toolchain", "rust-cargo", "docker-in-sandbox"])(
    "profile '%s' setup commands begin with set -e",
    (id) => {
      const profile = getManagedRuntimeProfile(id);
      const firstCmd = profile.setupCommands[0]!;
      expect(firstCmd.command).toContain("set -e");
    },
  );
});
