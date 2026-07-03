import { NextResponse, type NextRequest } from "next/server";

function wantsSharedMarkdown(acceptHeader: string | null): boolean {
  if (!acceptHeader) {
    return false;
  }

  const accept = acceptHeader.toLowerCase();
  return accept.includes("text/markdown") || accept.includes("text/plain");
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // #793: server components (async layouts in particular) cannot read the
  // incoming request's pathname/search directly — Next only exposes that
  // via `usePathname()` in Client Components. So MobileLayout can preserve
  // the original `/m/*` destination through its unauthenticated redirect,
  // stamp the incoming pathname+search onto a request header the layout
  // reads with `headers()`.
  if (pathname === "/m" || pathname.startsWith("/m/")) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(
      "x-invoke-path",
      `${pathname}${request.nextUrl.search}`,
    );
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (request.method !== "GET") {
    return NextResponse.next();
  }

  const segments = pathname.split("/").filter(Boolean);

  if (
    segments.length === 2 &&
    segments[0] === "shared" &&
    wantsSharedMarkdown(request.headers.get("accept"))
  ) {
    const rewrittenUrl = request.nextUrl.clone();
    rewrittenUrl.pathname = `/api/shared/${segments[1]}/markdown`;
    return NextResponse.rewrite(rewrittenUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/shared/:path*", "/m", "/m/:path*"],
};
