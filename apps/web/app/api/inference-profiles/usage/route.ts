import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { getInferenceProfileUsageSummary } from "@/lib/db/usage";

export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const usage = await getInferenceProfileUsageSummary(authResult.userId);
    return Response.json({ usage });
  } catch (error) {
    console.error("Failed to get inference profile usage:", error);
    return Response.json(
      {
        error: "Failed to get inference profile usage",
        errorKind: "internal_error",
      },
      { status: 500 },
    );
  }
}
