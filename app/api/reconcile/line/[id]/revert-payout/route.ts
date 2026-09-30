import { runInZohoOrgOr400, zohoOrgForBankLine, zohoOrgForSettlement, zohoOrgScoped } from "@/lib/integrations/zoho-org";
import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { executePayoutRevert, planPayoutRevert } from "@/lib/finance/revert-payout";

export const maxDuration = 300;

// Revert a wrongly uploaded payout that was already booked into Zoho.
//   GET  → the plan: every Zoho document this credit created (re-read live),
//          what will be deleted, what is skipped and why. Writes nothing.
//   POST { confirm: "REVERT", reason } → delete them, clear our records,
//          un-confirm the credit and remove the payout file so the correct
//          one can be uploaded. See lib/finance/revert-payout.ts.
type Ctx = { params: Promise<{ id: string }> };

async function handleGET(_req: Request, { params }: Ctx) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const { id } = await params;
  try {
    return NextResponse.json(await planPayoutRevert(id, await getAccessToken()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

async function handlePOST(request: Request, { params }: Ctx) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (body.confirm !== "REVERT") return NextResponse.json({ error: 'Type REVERT to confirm.' }, { status: 400 });
  const reason = String(body.reason ?? "").trim();
  if (!reason) return NextResponse.json({ error: "Say why this payout is being reverted." }, { status: 400 });
  try {
    const out = await executePayoutRevert({ bankLineId: id, actor: String(body.actor ?? "founder"), reason, accessToken: await getAccessToken() });
    return NextResponse.json(out, { status: out.completed ? 200 : 207 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Multi-org: every Zoho call below runs in the organisation of this bank credit's payout — lib/integrations/zoho-org.ts.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return runInZohoOrgOr400(await zohoOrgForBankLine((await ctx.params).id), () => (handleGET as (r: Request, c: unknown) => Promise<Response>)(req, ctx));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return runInZohoOrgOr400(await zohoOrgForBankLine((await ctx.params).id), () => (handlePOST as (r: Request, c: unknown) => Promise<Response>)(req, ctx));
}
