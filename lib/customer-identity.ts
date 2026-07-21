// Shared customer identity matching — extracted from app/api/customers/route.ts
// so the live API, order normalization (customer_id stamping), and the
// persisted customers table all resolve identity the exact same way and can
// never quietly drift apart.

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email || "").trim().toLowerCase();
  return e || null;
}

// Strips formatting/country-code variance (+971 / 00971 / 971 / 0) by
// comparing only the last 9 digits. Heuristic, not exact.
export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.length >= 6 ? digits.slice(-9) : null;
}

export type CustomerIdentity = { id: string; matchedBy: "email" | "phone" };

export function customerIdentityKey(
  email: string | null | undefined,
  phone: string | null | undefined,
): CustomerIdentity | null {
  const e = normalizeEmail(email);
  if (e) return { id: `email:${e}`, matchedBy: "email" };
  const p = normalizePhone(phone);
  if (p) return { id: `phone:${p}`, matchedBy: "phone" };
  return null;
}
