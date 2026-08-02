import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session/get-server-session";
import { getUserGitHubToken } from "@/lib/github/token";
import {
  fetchGitHubUser,
  GitHubRateLimitedError,
  GitHubTokenRejectedError,
} from "@/lib/github/users";

export async function GET() {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "GitHub not connected", errorKind: "unauthorized" },
      { status: 401 },
    );
  }

  const token = await getUserGitHubToken(session.user.id);

  if (!token) {
    return NextResponse.json(
      { error: "GitHub not connected", errorKind: "unauthorized" },
      { status: 401 },
    );
  }

  try {
    const user = await fetchGitHubUser(token);

    if (!user) {
      return NextResponse.json(
        { error: "Failed to fetch user", errorKind: "internal_error" },
        { status: 500 },
      );
    }

    return NextResponse.json(user);
  } catch (error) {
    if (error instanceof GitHubRateLimitedError) {
      return NextResponse.json(
        { error: "GitHub rate limit exceeded" },
        {
          status: 429,
          headers: error.retryAfterSeconds
            ? { "retry-after": `${error.retryAfterSeconds}` }
            : undefined,
        },
      );
    }

    if (error instanceof GitHubTokenRejectedError) {
      return NextResponse.json(
        { error: "GitHub not connected", errorKind: "unauthorized" },
        { status: 401 },
      );
    }

    console.error("Error fetching GitHub user:", error);
    return NextResponse.json(
      { error: "Failed to fetch user", errorKind: "internal_error" },
      { status: 500 },
    );
  }
}
