// Stub — implementation pending (RED phase)
type RouteContext = { params: Promise<{ loopId: string }> };

export async function POST(_req: Request, _ctx: RouteContext): Promise<Response> {
  return Response.json({ error: "Not implemented" }, { status: 501 });
}

export async function GET(_req: Request, _ctx: RouteContext): Promise<Response> {
  return Response.json({ error: "Not implemented" }, { status: 501 });
}
