// middleware.ts  (repo root, next to app/)
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-config";
import { verifySession } from "@/lib/session";

// Anything not matched by `config.matcher` below is public by default.
const PUBLIC_PATHS = ["/login", "/api/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // preserve where they were headed so we can bounce them back post-login
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // Optional: expose role to downstream server components via a header.
  const res = NextResponse.next();
  res.headers.set("x-omnia-role", session.role);
  return res;
}

// Guard everything except Next internals and static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};