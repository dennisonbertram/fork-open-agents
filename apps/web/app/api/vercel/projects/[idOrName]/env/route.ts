export async function GET() {
  return Response.json(
    { error: "Not found", errorKind: "not_found" },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
