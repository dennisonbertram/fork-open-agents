import { z } from "zod";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  getRepositoryComposioSettings,
  listComposioProfileOptionsForRepository,
  upsertRepositoryComposioSettings,
} from "@/lib/db/composio";
import { repositoryComposioSettingsInputSchema } from "@/lib/composio/types";

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

export async function GET(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const parsedParams = await parseRouteParams(context);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid repository" }, { status: 400 });
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
    return Response.json({ error: "Invalid repository" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedBody = repositoryComposioSettingsInputSchema.safeParse(body);
  if (!parsedBody.success) {
    return Response.json(
      { error: "Invalid repository Composio settings" },
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
      { error: "Repository Composio settings reference unknown profiles" },
      { status: 400 },
    );
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
