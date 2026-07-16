// lib/session.ts
// -----------------------------------------------------------------------------
// Signed session tokens. We don't want a user editing the cookie to hand
// themselves `admin`, so the payload (username|role|exp) is HMAC-signed with a
// server secret. Uses Web Crypto so it runs in BOTH the Node route handler and
// the Edge middleware runtime.
// -----------------------------------------------------------------------------

import type { Role } from "./auth-config";

const SECRET = process.env.OMNIA_SESSION_SECRET ?? "dev-only-change-me-in-prod";

export type Session = { username: string; role: Role; exp: number };

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}

export async function signSession(s: Session): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(s)));
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = await hmac(payload);
  // length-safe compare
  if (sig.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (mismatch !== 0) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as Session;
    if (typeof s.exp !== "number" || Date.now() > s.exp) return null;
    return s;
  } catch {
    return null;
  }
}