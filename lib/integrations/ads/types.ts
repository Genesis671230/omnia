// Canonical shape every ad platform's report gets flattened into. Nothing
// downstream (repository, scheduler, UI, AI tools) needs to know which
// platform a row came from beyond the `platform` field.

export type AdPlatform = "meta" | "google" | "tiktok" | "snap";

export type NormalizedInsight = {
  platform: AdPlatform;
  accountId: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  date: string; // YYYY-MM-DD
  spend: number;
  currency: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
};

export type DateRange = { from: string; to: string }; // YYYY-MM-DD, inclusive
