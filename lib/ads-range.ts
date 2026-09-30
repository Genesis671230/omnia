import { addDubaiDays, dubaiMonthBounds, dubaiToday } from "@/lib/dubai-day";

export const AD_RANGES = ["7d", "14d", "30d", "mtd"] as const;
export type AdRangeKey = (typeof AD_RANGES)[number];

/** Dubai days for an ads range key (inclusive; today counts as a day). */
export function adRangeFor(key: string, today = dubaiToday()): { key: AdRangeKey; from: string; to: string } {
  const k: AdRangeKey = (AD_RANGES as readonly string[]).includes(key) ? (key as AdRangeKey) : "7d";
  if (k === "mtd") return { key: k, from: dubaiMonthBounds(today, 0).fromDay, to: today };
  const days = k === "30d" ? 30 : k === "14d" ? 14 : 7;
  return { key: k, from: addDubaiDays(today, -(days - 1)), to: today };
}
