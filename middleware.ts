// middleware.ts  (repo root, next to app/)
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-config";
import { verifySession } from "@/lib/session";

// Anything not matched by `config.matcher` below is public by default.
const PUBLIC_PATHS = ["/login", "/api/login", "/confirm", "/api/confirm","/api/inventory/warehouse-matrix",
  // Public marketing surface for the commercial accounting product (numio).
  "/numio", "/api/numio",
  // Public RAMZA landing page + its lead intake and privacy page.
  // "/ramza" also covers every /ramza/* content page via the startsWith check.
  "/ramza", "/api/lead", "/privacy",
  // Crawler files. These MUST be listed: config.matcher below only exempts
  // _next assets and image extensions, so without an entry here both get the
  // session check and 302 to /login — invisible to every search engine.
  "/robots.txt", "/sitemap.xml",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  if (pathname.includes("/api/webhooks")) {
    return NextResponse.next();
}
  // n8n-facing endpoint — no browser session, guards itself with its own
  // Bearer-secret check (PAYMENT_CONFIRM_WEBHOOK_SECRET, fail-closed if
  // unset) in app/api/payments/confirm/route.ts, same posture as the HMAC
  // checks on the webhook routes above.
  if (pathname === "/api/payments/confirm") {
    return NextResponse.next();
  }
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    // An API call is made by fetch(), which follows the redirect and hands the
    // caller the /login PAGE. Every `.json()` in the app then dies on
    // `Unexpected token '<', "<!DOCTYPE "...` — a parser error standing in for
    // "your session expired", which reads to the user as broken data rather
    // than a sign-in prompt. Answer machines with a machine-readable 401.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Session expired — sign in again.", sessionExpired: true },
        { status: 401 },
      );
    }
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