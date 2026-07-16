// Static ad-account -> store mapping, confirmed with the founder 2026-07-15:
//
//   Meta Main (2 ad accounts) -> WOO   (targets the WooCommerce/.com site)
//   Meta KSA  (1 ad account)  -> KSA   (targets the Shopify KSA store)
//   TikTok                    -> WOO
//   Google Ads                -> WOO
//   Snapchat                  -> UAE   (targets the Shopify UAE store)
//   Shopify WA has no ad spend yet — omitted until an account targets it.
//
// Not a self-service UI — accounts are wired to stores here because the
// founder confirmed these mappings directly; the account ids themselves
// still live in .env alongside the credentials.

import type { AdPlatform } from "./integrations/ads/types";

type AccountStoreEntry = { platform: AdPlatform; accountId: string; store: string };

function metaMainAccountIds(): string[] {
  return (process.env.META_MAIN_AD_ACCOUNT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function buildMapping(): AccountStoreEntry[] {
  const entries: AccountStoreEntry[] = [];
  for (const id of metaMainAccountIds()) entries.push({ platform: "meta", accountId: id, store: "WOO" });
  if (process.env.META_KSA_AD_ACCOUNT_ID) {
    entries.push({ platform: "meta", accountId: process.env.META_KSA_AD_ACCOUNT_ID, store: "KSA" });
  }
  if (process.env.TIKTOK_ADVERTISER_ID) {
    entries.push({ platform: "tiktok", accountId: process.env.TIKTOK_ADVERTISER_ID, store: "WOO" });
  }
  if (process.env.GOOGLE_ADS_CUSTOMER_ID) {
    entries.push({ platform: "google", accountId: process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, ""), store: "WOO" });
  }
  if (process.env.SNAP_AD_ACCOUNT_ID) {
    entries.push({ platform: "snap", accountId: process.env.SNAP_AD_ACCOUNT_ID, store: "UAE" });
  }
  return entries;
}

export function storeForAccount(platform: AdPlatform, accountId: string): string {
  const match = buildMapping().find((e) => e.platform === platform && e.accountId === accountId);
  return match?.store ?? "UNKNOWN";
}
