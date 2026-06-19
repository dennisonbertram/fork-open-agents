import "server-only";

export type SecretScope = "repository" | "environment" | "organization";

export type ScopeRoute = {
  scope: SecretScope;
  publicKeyPath: string;
  requiredPermission: "secrets" | "environments";
  permissionLevel: "read" | "write";
};

type RouteContext = {
  owner: string;
  repo: string;
  permissionLevel: "read" | "write";
};

export function routeForScope(
  scope: SecretScope,
  ctx: RouteContext,
): ScopeRoute {
  if (scope !== "repository") {
    throw new Error("scope_not_supported_in_v1");
  }

  return {
    scope,
    publicKeyPath: `/repos/${ctx.owner}/${ctx.repo}/actions/secrets/public-key`,
    requiredPermission: "secrets",
    permissionLevel: ctx.permissionLevel,
  };
}
