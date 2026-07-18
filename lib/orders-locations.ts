// Known cities per emirate/region, shared between the Orders ledger's
// location filter dropdown (client) and the paginated orders query (server)
// — a single source of truth so the two never drift out of sync. Matched
// case-insensitively against the order's `city` field, which is free text
// synced from Shopify/Woo — not every order matches a known group.
export const LOCATION_GROUPS: Record<string, string[]> = {
  "Dubai": ["dubai"],
  "Abu Dhabi": ["abu dhabi", "abudhabi"],
  "Sharjah": ["sharjah"],
  "Riyadh": ["riyadh"],
  "Jeddah": ["jeddah", "jedda"],
  "Other UAE": ["ajman", "fujairah", "ras al khaimah", "rak", "umm al quwain"],
  "Other KSA": ["dammam", "khobar", "mecca", "makkah", "medina"],
};

export function locationGroupFor(city: string): string | null {
  const c = (city || "").toLowerCase();
  for (const [group, keywords] of Object.entries(LOCATION_GROUPS)) {
    if (keywords.some((k) => c.includes(k))) return group;
  }
  return null;
}

// Keywords for a location filter value sent from the client, or null if the
// value isn't a real filter ("All locations" / unrecognized).
export function keywordsForLocation(location: string): string[] | null {
  return LOCATION_GROUPS[location] ?? null;
}
