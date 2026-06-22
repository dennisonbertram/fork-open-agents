import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { listRepositorySidebarArchives } from "@/lib/db/repository-sidebar-archives";

export type RepositorySidebarArchivesResponse = {
  repositories: Array<{
    repoOwner: string;
    repoName: string;
  }>;
};

export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const repositories = await listRepositorySidebarArchives(authResult.userId);

  return Response.json({
    repositories: repositories.map((repository) => ({
      repoOwner: repository.repoOwner,
      repoName: repository.repoName,
    })),
  } satisfies RepositorySidebarArchivesResponse);
}
