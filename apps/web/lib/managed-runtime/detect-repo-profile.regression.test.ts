/**
 * Regression tests for detectRepoProfile.
 *
 * These tests catch future breakage when:
 * - Profile ids are renamed/removed
 * - Precedence order changes
 * - A new file extension is incorrectly matched
 * - The null fallback is broken
 */

import { describe, expect, test } from "bun:test";
import { detectRepoProfile } from "./detect-repo-profile";

describe("detectRepoProfile — regression", () => {
  // If python-uv id is renamed, this fails immediately
  test("pyproject.toml always maps to exactly 'python-uv' (id mutation guard)", () => {
    expect(detectRepoProfile(["pyproject.toml"])).toBe("python-uv");
  });

  // If go-toolchain id is renamed, this fails immediately
  test("go.mod always maps to exactly 'go-toolchain' (id mutation guard)", () => {
    expect(detectRepoProfile(["go.mod"])).toBe("go-toolchain");
  });

  // If rust-cargo id is renamed, this fails immediately
  test("Cargo.toml always maps to exactly 'rust-cargo' (id mutation guard)", () => {
    expect(detectRepoProfile(["Cargo.toml"])).toBe("rust-cargo");
  });

  // If docker-in-sandbox id is renamed, this fails immediately
  test("Dockerfile always maps to exactly 'docker-in-sandbox' (id mutation guard)", () => {
    expect(detectRepoProfile(["Dockerfile"])).toBe("docker-in-sandbox");
  });

  // Precedence regression: Python must win over Go when both present
  test("python-uv wins over go-toolchain (precedence regression)", () => {
    expect(detectRepoProfile(["pyproject.toml", "go.mod"])).toBe("python-uv");
  });

  // Precedence regression: Python must win over Rust when both present
  test("python-uv wins over rust-cargo (precedence regression)", () => {
    expect(detectRepoProfile(["requirements.txt", "Cargo.toml"])).toBe(
      "python-uv",
    );
  });

  // Precedence regression: Go must win over Rust when both present
  test("go-toolchain wins over rust-cargo (precedence regression)", () => {
    expect(detectRepoProfile(["go.mod", "Cargo.toml"])).toBe("go-toolchain");
  });

  // Null-fallback regression: non-matching files must never accidentally match
  test("JavaScript/TypeScript files do not trigger any profile (no accidental match)", () => {
    expect(
      detectRepoProfile([
        "package.json",
        "tsconfig.json",
        "src/index.ts",
        "bun.lockb",
      ]),
    ).toBe(null);
  });

  // Regression: deeply-nested markers still match
  test("deeply nested pyproject.toml still detected (path matching regression)", () => {
    expect(
      detectRepoProfile([
        "README.md",
        "packages/core/pyproject.toml",
        "packages/core/src/main.py",
      ]),
    ).toBe("python-uv");
  });

  // Regression: docker-compose.yml variant (not just Dockerfile)
  test("docker-compose.yml also triggers docker-in-sandbox (variant guard)", () => {
    expect(detectRepoProfile(["docker-compose.yml"])).toBe("docker-in-sandbox");
  });
});
