import { describe, expect, test } from "bun:test";
import { detectRepoProfile } from "./detect-repo-profile";

// BT-005: detect-repo-profile marker → id mapping

describe("detectRepoProfile", () => {
  // Each test uses the string[] overload (file path strings)

  test("detects python-uv from pyproject.toml", () => {
    expect(detectRepoProfile(["pyproject.toml", "src/main.py"])).toBe(
      "python-uv",
    );
  });

  test("detects python-uv from requirements.txt", () => {
    expect(detectRepoProfile(["requirements.txt", "app.py"])).toBe("python-uv");
  });

  test("detects python-uv from a .py file alone", () => {
    expect(detectRepoProfile(["scripts/run.py"])).toBe("python-uv");
  });

  test("detects go-toolchain from go.mod", () => {
    expect(detectRepoProfile(["go.mod", "main.go"])).toBe("go-toolchain");
  });

  test("detects rust-cargo from Cargo.toml", () => {
    expect(detectRepoProfile(["Cargo.toml", "src/main.rs"])).toBe("rust-cargo");
  });

  test("detects docker-in-sandbox from Dockerfile", () => {
    expect(detectRepoProfile(["Dockerfile", "compose.yml"])).toBe(
      "docker-in-sandbox",
    );
  });

  test("detects docker-in-sandbox from docker-compose.yml", () => {
    expect(detectRepoProfile(["docker-compose.yml"])).toBe("docker-in-sandbox");
  });

  test("returns null when no markers are present", () => {
    expect(detectRepoProfile(["README.md", "index.html", "styles.css"])).toBe(
      null,
    );
  });

  test("returns null for an empty file list", () => {
    expect(detectRepoProfile([])).toBe(null);
  });

  // BT-005a: deterministic precedence — Python wins over Docker when both present
  test("precedence: python-uv wins over docker-in-sandbox when both markers present", () => {
    expect(detectRepoProfile(["pyproject.toml", "Dockerfile"])).toBe(
      "python-uv",
    );
  });

  // BT-005b: go wins over Docker
  test("precedence: go-toolchain wins over docker-in-sandbox when both markers present", () => {
    expect(detectRepoProfile(["go.mod", "Dockerfile"])).toBe("go-toolchain");
  });

  // BT-005c: rust wins over Docker
  test("precedence: rust-cargo wins over docker-in-sandbox when both markers present", () => {
    expect(detectRepoProfile(["Cargo.toml", "Dockerfile"])).toBe("rust-cargo");
  });

  // BT-005d: { path: string }[] overload
  test("accepts object array overload { path: string }[]", () => {
    expect(
      detectRepoProfile([{ path: "pyproject.toml" }, { path: "src/app.py" }]),
    ).toBe("python-uv");
  });

  test("detects go.mod via object array overload", () => {
    expect(
      detectRepoProfile([{ path: "go.mod" }, { path: "cmd/main.go" }]),
    ).toBe("go-toolchain");
  });
});
