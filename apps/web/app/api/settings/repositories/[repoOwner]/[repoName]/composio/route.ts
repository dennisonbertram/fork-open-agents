import { z } from "zod";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  getRepositoryComposioSettings,
  listComposioProfileOptionsForRepository,
  upsertRepositoryComposioSettings,
} from "@/lib/db/composio";
import { repositoryComposioSettingsInputSchema } from "@/lib/composio/types";
import { getComposioClient } from "@/lib/composio/client";
import { getComposioConfig } from "@/lib/composio/config";
import { redactComposioErrorMessage } from "@/lib/composio/errors";

type RouteContext = {
  params: Promise<{ repoOwner: string; repoName: string }>;
};

const routeParamsSchema = z.object({
  repoOwner: z.string().trim().min(1),
  repoName: z.string().trim().min(1),
});

export type RepositoryComposioSettingsResponse = Awaited<
  ReturnType<typeof listComposioProfileOptionsForRepository>
> & {
  repoOwner: string;
  repoName: string;
};

async function parseRouteParams(context: RouteContext) {
  const params = await context.params;
  return routeParamsSchema.safeParse({
    repoOwner: decodeURIComponent(params.repoOwner),
    repoName: decodeURIComponent(params.repoName),
  });
}

/** Structural view of the @composio/core toolkit list item (avoids `any`). */
interface RawToolkitSlugOnly {
  slug?: string;
}

/**
 * Fetches the known Composio toolkit catalog slug set (#799, finding B3),
 * mirroring the toolkits route's own catalog source
 * (apps/web/app/api/composio/toolkits/route.ts) so blockedToolkitSlugs is
 * validated against every toolkit that exists in Composio's catalog — NOT
 * just the user's connected accounts, so a pre-emptive block on a toolkit
 * never connected still validates.
 *
 * Returns a distinct `{ ok: false }` result on lookup failure so the caller
 * can surface an explicit error instead of silently accepting an
 * unvalidated slug.
 */
async function fetchKnownToolkitSlugs(): Promise<
  { ok: true; slugs: Set<string> } | { ok: false; message: string }
> {
  if (!getComposioConfig().configured) {
    // No API key configured — there is no catalog to validate against.
    // Treat as an empty, permissive catalog rather than a hard failure so
    // deployments without Composio configured are not blocked from saving
    // unrelated repository settings.
    return { ok: true, slugs: new Set() };
  }

  try {
    const client = getComposioClient();
    const response = (await client.toolkits.get({})) as unknown as {
      items?: RawToolkitSlugOnly[];
    };
    const items = Array.isArray(response)
      ? (response as RawToolkitSlugOnly[])
      : (response.items ?? []);
    const slugs = new Set(
      items
        .map((item) => item.slug)
        .filter(Boolean)
        .map((slug) => (slug as string).toLowerCase()),
    );
    return { ok: true, slugs };
  } catch (error) {
    const message = redactComposioErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
    return {
      ok: false,
      message: message || "Failed to load Composio toolkit catalog",
    };
  }
}

export async function GET(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const parsedParams = await parseRouteParams(context);
  if (!parsedParams.success) {
    return Response.json(
      { error: "Invalid repository", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await listComposioProfileOptionsForRepository({
    userId: authResult.userId,
    repoOwner: parsedParams.data.repoOwner,
    repoName: parsedParams.data.repoName,
  });

  return Response.json({
    ...result,
    repoOwner: parsedParams.data.repoOwner,
    repoName: parsedParams.data.repoName,
  } satisfies RepositoryComposioSettingsResponse);
}

export async function PATCH(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const parsedParams = await parseRouteParams(context);
  if (!parsedParams.success) {
    return Response.json(
      { error: "Invalid repository", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const parsedBody = repositoryComposioSettingsInputSchema.safeParse(body);
  if (!parsedBody.success) {
    return Response.json(
      {
        error: "Invalid repository Composio settings",
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  const profiles = await listComposioProfileOptionsForRepository({
    userId: authResult.userId,
  });
  const ownedProfileIds = new Set(
    profiles.profiles.map((profile) => profile.id),
  );
  const unknownProfileIds = parsedBody.data.allowedProfileIds.filter(
    (profileId) => !ownedProfileIds.has(profileId),
  );
  if (unknownProfileIds.length > 0) {
    return Response.json(
      {
        error: "Repository Composio settings reference unknown profiles",
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  // Validate blockedToolkitSlugs against the known Composio toolkit catalog
  // (#799, finding B3) — rejects typos like "gmial" with a 400 naming the
  // slug, instead of silently persisting a denylist entry that can never
  // match a real toolkit. Validated against the FULL catalog, not the
  // user's connected accounts, so a pre-emptive block on a never-connected
  // toolkit still saves.
  if (parsedBody.data.blockedToolkitSlugs.length > 0) {
    const catalogResult = await fetchKnownToolkitSlugs();
    if (!catalogResult.ok) {
      return Response.json(
        {
          error: `Could not validate blocked toolkits: ${catalogResult.message}`,
          errorKind: "upstream_unavailable",
        },
        { status: 502 },
      );
    }
    if (catalogResult.slugs.size > 0) {
      const unknownToolkitSlugs = parsedBody.data.blockedToolkitSlugs.filter(
        (slug) => !catalogResult.slugs.has(slug.toLowerCase()),
      );
      if (unknownToolkitSlugs.length > 0) {
        return Response.json(
          {
            error: `Repository Composio settings reference unrecognized toolkit slugs: ${unknownToolkitSlugs.join(", ")}`,
            errorKind: "invalid_request",
          },
          { status: 400 },
        );
      }
    }
  }

  const settings = await upsertRepositoryComposioSettings({
    userId: authResult.userId,
    repoOwner: parsedParams.data.repoOwner,
    repoName: parsedParams.data.repoName,
    settings: parsedBody.data,
  });
  const result = await listComposioProfileOptionsForRepository({
    userId: authResult.userId,
    repoOwner: parsedParams.data.repoOwner,
    repoName: parsedParams.data.repoName,
  });

  return Response.json({
    ...result,
    repositorySettings:
      result.repositorySettings ??
      (await getRepositoryComposioSettings({
        userId: authResult.userId,
        repoOwner: settings.repoOwner,
        repoName: settings.repoName,
      })) ??
      settings,
    repoOwner: parsedParams.data.repoOwner,
    repoName: parsedParams.data.repoName,
  } satisfies RepositoryComposioSettingsResponse);
}
