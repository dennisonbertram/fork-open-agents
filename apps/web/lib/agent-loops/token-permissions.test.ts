import { describe, expect, it } from "bun:test";
import {
  effectiveStepPermissions,
  permissionsToInstallationToken,
} from "./token-permissions";

describe("permissionsToInstallationToken", () => {
  it("always includes contents:write (clone + push baseline)", () => {
    expect(permissionsToInstallationToken(undefined)).toEqual({
      contents: "write",
    });
    expect(permissionsToInstallationToken({})).toEqual({ contents: "write" });
  });

  it("maps camelCase scopes to snake_case token keys", () => {
    const token = permissionsToInstallationToken({
      github: {
        pullRequests: "write",
        issues: "write",
        deployments: "read",
        statuses: "read",
        checks: "read",
      },
    });
    expect(token).toEqual({
      contents: "write",
      pull_requests: "write",
      issues: "write",
      deployments: "read",
      statuses: "read",
      checks: "read",
    });
  });

  it("grants issues:write so an agent step can create issues", () => {
    const token = permissionsToInstallationToken({
      github: { issues: "write" },
    });
    expect(token.issues).toBe("write");
    expect(token.contents).toBe("write");
  });

  it("keeps contents:write even when contents is declared read", () => {
    const token = permissionsToInstallationToken({
      github: { contents: "read", issues: "read" },
    });
    expect(token.contents).toBe("write");
    expect(token.issues).toBe("read");
  });
});

describe("effectiveStepPermissions", () => {
  const stepPerms = { github: { issues: "write" as const } };
  const loopPerms = { github: { pullRequests: "write" as const } };

  it("prefers the step's own permissions when set", () => {
    expect(effectiveStepPermissions(stepPerms, loopPerms)).toBe(stepPerms);
  });

  it("falls back to loop permissions when the step has none", () => {
    expect(effectiveStepPermissions(undefined, loopPerms)).toBe(loopPerms);
    expect(effectiveStepPermissions({ github: {} }, loopPerms)).toBe(loopPerms);
  });

  it("returns undefined when neither is set", () => {
    expect(effectiveStepPermissions(undefined, undefined)).toBeUndefined();
  });
});
