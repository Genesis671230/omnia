// app/api/login/route.ts
import { NextResponse } from "next/server";
import { verifyCredentials, landingFor, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth-config";
import { signSession } from "@/lib/session";

export async function POST(req: Request) {
  let username = "";
  let password = "";
  try {
    const body = await req.json();
    username = String(body.username ?? "");
    password = String(body.password ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const role = verifyCredentials(username, password);
  if (!role) {
    // Deliberately vague — don't reveal whether the username or the password
    // was the wrong part.
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }

  const exp = Date.now() + SESSION_MAX_AGE * 1000;
  const token = await signSession({ username: username.trim().toLowerCase(), role, exp });

  const res = NextResponse.json({ ok: true, role, redirect: landingFor(role) });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}