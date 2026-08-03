import { fetchAvailableLanguageModelsWithContext } from "@/lib/models-with-context";

const CACHE_CONTROL = "private, no-store";

export async function GET(_req: Request) {
  try {
    const models = await fetchAvailableLanguageModelsWithContext();

    return Response.json(
      { models },
      {
        headers: {
          "Cache-Control": CACHE_CONTROL,
        },
      },
    );
  } catch (error) {
    console.error("Failed to fetch available models:", error);
    return Response.json(
      {
        error: "Failed to fetch available models",
        errorKind: "internal_error",
      },
      { status: 500 },
    );
  }
}
