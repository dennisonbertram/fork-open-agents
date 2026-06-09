/**
 * Stub — returns 501 until implemented.
 */

type RouteContext = {
  params: Promise<{ profileId: string }>;
};

export async function PATCH(_req: Request, _ctx: RouteContext): Promise<Response> {
  return Response.json({ error: "Not implemented" }, { status: 501 });
}

export async function DELETE(_req: Request, _ctx: RouteContext): Promise<Response> {
  return Response.json({ error: "Not implemented" }, { status: 501 });
}
