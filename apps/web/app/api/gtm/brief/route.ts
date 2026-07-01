import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { isValidGtmSnapshotWindow } from "@/lib/gtm-coordinator/snapshot";
import { buildDbBackedGtmSnapshot } from "@/lib/gtm-coordinator/store";

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const url = new URL(req.url);
  const window = url.searchParams.get("window");
  if (!isValidGtmSnapshotWindow(window)) {
    return Response.json(
      {
        error: "Invalid window",
        errorKind: "invalid_window",
        supportedFormat: "1h through 168h",
      },
      { status: 400 },
    );
  }

  const snapshot = await buildDbBackedGtmSnapshot({
    userId: authResult.userId,
    window,
  });

  return Response.json(snapshot);
}
