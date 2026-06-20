import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const scopeRouterModulePromise = import("./scope-router");

describe("routeForScope", () => {
  test("routes repository public-key reads through the repository secrets endpoint", async () => {
    const { routeForScope } = await scopeRouterModulePromise;
    const route = routeForScope("repository", {
      owner: "acme",
      repo: "widgets",
      permissionLevel: "write",
    });

    expect(route).toEqual({
      scope: "repository",
      publicKeyPath: "/repos/acme/widgets/actions/secrets/public-key",
      requiredPermission: "secrets",
      permissionLevel: "write",
    });
  });

  test("keeps environment and organization scopes explicitly unsupported in v1", async () => {
    const { routeForScope } = await scopeRouterModulePromise;
    expect(() =>
      routeForScope("environment", {
        owner: "acme",
        repo: "widgets",
        permissionLevel: "read",
      }),
    ).toThrow("scope_not_supported_in_v1");

    expect(() =>
      routeForScope("organization", {
        owner: "acme",
        repo: "widgets",
        permissionLevel: "read",
      }),
    ).toThrow("scope_not_supported_in_v1");
  });
});
