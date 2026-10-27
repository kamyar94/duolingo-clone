import { NextResponse, type NextRequest } from "next/server";

// First gate only: lets through requests that carry a session cookie. Every page and API route
// still checks the session itself against the database.
const SESSION_COOKIE = "lingo_session";
const PUBLIC_PATHS = ["/", "/sign-in", "/sign-up", "/api/health"];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.includes(pathname) || req.cookies.has(SESSION_COOKIE))
    return NextResponse.next();

  if (pathname.startsWith("/api/") || pathname.startsWith("/media/"))
    return new NextResponse("Unauthorized.", { status: 401 });

  // Relative redirect, so it stays on https behind the Cloudflare tunnel.
  return new NextResponse(null, {
    status: 307,
    headers: { Location: "/sign-in" },
  });
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp3|wav)).*)",
    "/(api|trpc)(.*)",
  ],
};
