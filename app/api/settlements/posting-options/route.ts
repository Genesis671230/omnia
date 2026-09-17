import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { fetchPostingOptions, type PostingOptions } from "@/lib/integrations/zoho-settlement-posting";

export const maxDuration = 60;

// GET /api/settlements/posting-options — the accounts and taxes the gateway
// proof panel offers for booking a payout (Deposit To, gateway charges, VAT,
// Exchange Gain or Loss). Three Zoho reads, cached so opening several payouts
// in a row doesn't spend the daily API budget. ?refresh=1 bypasses the cache.
const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; data: PostingOptions } | null = null;

export async function GET(request: Request) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  if (!refresh && cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data);
  try {
    const data = await fetchPostingOptions(await getAccessToken());
    cache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
