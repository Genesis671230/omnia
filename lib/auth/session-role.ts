import { cookies } from "next/headers";
import { SESSION_COOKIE, type Role } from "@/lib/auth-config";
import { verifySession, type Session } from "@/lib/session";

/** The signed-in session inside a route handler (middleware already rejected
 *  requests without one; this is for role checks on sensitive writes). */
export async function currentSession(): Promise<Session | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** null when allowed, otherwise the 403 response to return. */
export async function requireRole(...roles: Role[]): Promise<{ session: Session } | { denied: Response }> {
  const s = await currentSession();
  if (!s || !roles.includes(s.role)) {
    return { denied: Response.json({ error: `Only ${roles.join(" / ")} can do this` }, { status: 403 }) };
  }
  return { session: s };
}
