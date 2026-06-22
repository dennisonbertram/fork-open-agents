import { z } from "zod";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  archiveRepositoryInSidebar,
  unarchiveRepositoryInSidebar,
} from "@/lib/db/repository-sidebar-archives";

type RouteContext = {
  params: Promise<{ repoOwner: string; repoName: string }>;
};

const routeParamsSchema = z.object({
  repoOwner: z.string().trim().min(1),
  repoName: z.string().trim().min(1),
});

async function parseRouteParams(context: RouteContext) {
  const params = await context.params;
  return routeParamsSchema.safeParse({
    repoOwner: decodeURIComponent(params.repoOwner),
    repoName: decodeURIComponent(params.repoName),
  });
}

export async function PUT(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const parsedParams = await parseRouteParams(context);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid repository" }, { status: 400 });
  }

  const repository = await archiveRepositoryInSidebar({
    userId: authResult.userId,
    repoOwner: parsedParams.data.repoOwner,
    repoName: parsedParams.data.repoName,
  });

  return Response.json({
    archived: true,
    repoOwner: repository.repoOwner,
    repoName: repository.repoName,
  });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const parsedParams = await parseRouteParams(context);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid repository" }, { status: 400 });
  }

  await unarchiveRepositoryInSidebar({
    userId: authResult.userId,
    repoOwner: parsedParams.data.repoOwner,
    repoName: parsedParams.data.repoName,
  });

  return Response.json({
    archived: false,
    repoOwner: parsedParams.data.repoOwner,
    repoName: parsedParams.data.repoName,
  });
}
