// lib/auth-config.ts
// -----------------------------------------------------------------------------
// TEMPORARY hardcoded auth. This is a stopgap until real RBAC lands.
// Everything role-related is centralized here so the swap to a DB/RBAC layer
// later means replacing ONLY this file's `USERS` map + the verify function.
//
// SECURITY NOTE: passwords live server-side only. This module must never be
// imported into a client component. It's consumed by the /api/login route and
// middleware (both server contexts). Do not `"use client"` anything that pulls
// this in.
// -----------------------------------------------------------------------------

export type Role =
  | "admin"
  | "marketing"
  | "shipment"
  | "packaging"
  | "finance"
  | "supplier"
  | "support";

export const ROLES: { role: Role; label: string; landing: string }[] = [
  { role: "admin",     label: "Admin",            landing: "/" },
  { role: "finance",   label: "Finance",          landing: "/reconciliation" },
  { role: "marketing", label: "Marketing",        landing: "/marketing" },
  { role: "shipment",  label: "Shipment",         landing: "/shipments" },
  { role: "packaging", label: "Packaging",        landing: "/packaging" },
  { role: "supplier",  label: "Supplier",         landing: "/supplier" },
  { role: "support",   label: "Customer Support", landing: "/support" },
];

// Hardcoded credentials. Override any of these via env in production so real
// secrets never sit in the repo — falls back to the dev defaults below.
// e.g. OMNIA_PW_FINANCE=•••••••  in .env.local
type Cred = { role: Role; password: string };

const USERS: Record<string, Cred> = {
  admin:     { role: "admin",     password: process.env.OMNIA_PW_ADMIN     ?? "omnia-admin-2026" },
  finance:   { role: "finance",   password: process.env.OMNIA_PW_FINANCE   ?? "omnia-finance-2026" },
  marketing: { role: "marketing", password: process.env.OMNIA_PW_MARKETING ?? "omnia-marketing-2026" },
  shipment:  { role: "shipment",  password: process.env.OMNIA_PW_SHIPMENT  ?? "omnia-shipment-2026" },
  packaging: { role: "packaging", password: process.env.OMNIA_PW_PACKAGING ?? "omnia-packaging-2026" },
  supplier:  { role: "supplier",  password: process.env.OMNIA_PW_SUPPLIER  ?? "omnia-supplier-2026" },
  support:   { role: "support",   password: process.env.OMNIA_PW_SUPPORT   ?? "omnia-support-2026" },
};

export const SESSION_COOKIE = "omnia_session";
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12h

// Constant-time-ish compare so we don't leak length/early-exit timing on the
// password check. Good enough for a stopgap; real RBAC will hash server-side.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // still compare against a fixed string to avoid a fast path
    let acc = 1;
    for (let i = 0; i < b.length; i++) acc |= b.charCodeAt(i);
    return false && acc === 0;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** Verify a username+password. Returns the Role on success, null otherwise. */
export function verifyCredentials(username: string, password: string): Role | null {
  const u = USERS[username.trim().toLowerCase()];
  if (!u) return null;
  return safeEqual(u.password, password) ? u.role : null;
}

export function landingFor(role: Role): string {
  return ROLES.find((r) => r.role === role)?.landing ?? "/";
}