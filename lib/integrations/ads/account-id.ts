// Canonical internal form for an ad account id is the BARE numeric id.
// `act_` is a Graph API URL prefix, not part of the id — it is added only
// when building a request URL.
//
// This exists as one shared helper on purpose. `.env` may hold either form,
// and lib/ads-accounts.ts matches insight rows to stores by string equality.
// If normalization lived in only one of those places the two would desync,
// every insight would map to store "UNKNOWN", and /api/ads/summary (which
// filters on WOO/KSA/UAE) would render an empty panel while the sync
// reported success. Normalize once, here, and use it on both sides.

export function normalizeAdAccountId(raw: string): string {
  return raw.trim().replace(/^act_/i, "");
}
