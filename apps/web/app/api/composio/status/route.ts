import {
  getComposioConfiguredStatus,
  getComposioDisabledStatus,
  getComposioUnavailableStatus,
} from "@/lib/composio/config";
import { getComposioClient } from "@/lib/composio/client";
import { toComposioUserId } from "@/lib/composio/user-id";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";

type ComposioStatus =
  | ReturnType<typeof getComposioConfiguredStatus>
  | ReturnType<typeof getComposioDisabledStatus>
  | ReturnType<typeof getComposioUnavailableStatus>;

export interface ComposioStatusResponse {
  status: ComposioStatus;
}

export async function GET(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const shouldCheckLive = new URL(req.url).searchParams.get("live") === "1";

  try {
    const client = getComposioClient();
    if (shouldCheckLive) {
      await client.connectedAccounts.list({
        userIds: [toComposioUserId(authResult.userId)],
      });
    }

    return Response.json({
      status: getComposioConfiguredStatus(),
    } satisfies ComposioStatusResponse);
  } catch (error) {
    if (error instanceof Error && error.message.includes("COMPOSIO_API_KEY")) {
      return Response.json({
        status: getComposioDisabledStatus(),
      } satisfies ComposioStatusResponse);
    }

    return Response.json({
      status: getComposioUnavailableStatus(error),
    } satisfies ComposioStatusResponse);
  }
}
