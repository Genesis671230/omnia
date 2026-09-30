import { zohoConnectionId } from "@/lib/integrations/zoho-context";
import { runInZohoOrgOr400, zohoOrgForBankLine, zohoOrgScoped } from "@/lib/integrations/zoho-org";
import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { fetchPostingOptions, type PostingOptions } from "@/lib/integrations/zoho-settlement-posting";

export const maxDuration = 60;

// GET /api/settlements/posting-options — the accounts and taxes the gateway
// proof panel offers for booking a payout (Deposit To, gateway charges, VAT,
// Exchange Gain or Loss). Three Zoho reads, cached so opening several payouts
// in a row doesn't spend the daily API budget. ?refresh=1 bypasses the cache.
const TTL_MS = 10 * 60 * 1000;
// Keyed by Zoho organisation — one org's accounts must never be served to another.
const caches = new Map<string, { at: number; data: PostingOptions }>();

async function handleGET(request: Request) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const cache = caches.get(zohoConnectionId());
  if (!refresh && cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data);
  try {
    const data = await fetchPostingOptions(await getAccessToken());
    caches.set(zohoConnectionId(), { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

// Multi-org: ?bankLineId= → the accounts of the organisation that payout
// settles into (so the booking dialog can never offer another org's
// accounts); otherwise ?zohoOrg= (default: main). lib/integrations/zoho-org.ts.
export async function GET(req: Request) {
  const bankLineId = new URL(req.url).searchParams.get("bankLineId");
  if (bankLineId) return runInZohoOrgOr400(await zohoOrgForBankLine(bankLineId), () => handleGET(req));
  return zohoOrgScoped(req, () => handleGET(req));
}
