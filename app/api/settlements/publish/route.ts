import { ENV_CONNECTION_ID, zohoConnectionId } from "@/lib/integrations/zoho-context";
import { runInZohoOrgOr400, zohoOrgForBankLine, zohoOrgForSettlement, zohoOrgScoped } from "@/lib/integrations/zoho-org";
import { NextResponse } from "next/server";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { ZohoPublishRunsRepository } from "@/lib/repositories/zoho-publish-runs.repository";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { publishSettlements, type DeliveryIntercompanyAccounts } from "@/lib/finance/publish-settlements";

// A 28-order payout is ~150 paced Zoho calls.
export const maxDuration = 300;

// POST /api/settlements/publish
//   body: {
//     bankLineId: string,              — the confirmed bank credit
//     settlementIds?: string[],        — a subset; omit for every order on it
//     depositAccountId: string,        — clearing account, e.g. "TABBY AED"
//     feeAccountId: string,            — e.g. "Payment Gateway Charges"
//     vatTaxId?: string,               — AED payouts: fee is VAT-inclusive
//     differenceAccountId?: string,    — Exchange Gain or Loss
//     referenceNumberOverride?: string,
//     deliveryAccountId?: string,      — COD: expense account for courier delivery charges
//     deliveryOnly?: boolean,          — COD: book just the delivery charges
//     deliveryIntercompany?: {         — COD: charges that belong to a sister company,
//       [zohoConnectionId]: { dueFromAccountId, expenseAccountId, dueToAccountId, vatTaxId?, inputVatAccountId? }
//     },                                 see publishDeliveryCharges()
//     bookFeesOnExternallyPaid?: boolean — also book fee/FX on invoices
//                                         already paid by hand in Zoho
//     dryRun?: boolean,                — reads Zoho, writes nothing
//   }
//
// Per order: payment for the full invoice → fee expense → FX/rounding journal.
// See lib/finance/publish-settlements.ts.
async function handlePOST(request: Request) {
  if (!zohoConfigured()) {
    return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const bankLineId = str(body.bankLineId);
  const settlementIds: string[] = Array.isArray(body.settlementIds) ? body.settlementIds.map(String) : [];
  const dryRun = body.dryRun === true;
  const accounts = {
    depositAccountId: str(body.depositAccountId ?? body.accountId),
    feeAccountId: str(body.feeAccountId),
    vatTaxId: str(body.vatTaxId) || null,
    differenceAccountId: str(body.differenceAccountId) || null,
    deliveryAccountId: str(body.deliveryAccountId) || null,
  };
  // COD vouchers: book only the courier's delivery / return charges.
  const deliveryOnly = body.deliveryOnly === true;
  const deliveryIntercompany = parseIntercompany(body.deliveryIntercompany);

  if (!bankLineId) {
    return NextResponse.json({ error: "bankLineId is required" }, { status: 400 });
  }
  if (!accounts.depositAccountId) {
    return NextResponse.json({ error: "Pick the Deposit To (clearing) account first." }, { status: 400 });
  }

  const line = (await runReconciliation()).find((l) => l.id === bankLineId);
  if (!line) return NextResponse.json({ error: `No reconciliation line ${bankLineId}` }, { status: 404 });
  // Defence in depth: the org this request runs in (resolved from recon_lines)
  // must be the one on the freshly computed line's payout.
  // Orders may carry their own org (mixed-company payout); the rest follow the
  // payout's. This request books only the orders whose org is the one in scope.
  const lineOrg = line.payout?.zohoConnectionId || ENV_CONNECTION_ID;
  const scopeOrg = zohoConnectionId();
  const orgOf = (s: { zoho_connection_id?: string | null }) => s.zoho_connection_id || lineOrg;
  if (!line.confirmedBy) {
    return NextResponse.json({ error: "Confirm this settlement before recording payments." }, { status: 409 });
  }
  if (!line.payout) return NextResponse.json({ error: "This bank credit has no matched payout file." }, { status: 409 });

  // Rows written after the credit was confirmed (e.g. a re-uploaded payout
  // file) are born unconfirmed; the confirmation covers them too.
  await SettlementsRepository.confirmEvidenceForBankLine(line.id, line.confirmedBy);

  const all = await SettlementsRepository.listByBankLineId(line.id);
  const wanted = settlementIds.length > 0 ? new Set(settlementIds) : null;
  const requested = deliveryOnly ? [] : all.filter((s) => !wanted || wanted.has(s.id));
  const otherOrg = requested.filter((s) => orgOf(s) !== scopeOrg);
  if (wanted && otherOrg.length) {
    return NextResponse.json({
      error: `${otherOrg.map((s) => s.order_number).join(", ")} close${otherOrg.length === 1 ? "s" : ""} in another organisation — book ${otherOrg.length === 1 ? "it" : "them"} with that organisation selected (or reopen the drawer if it just changed).`,
    }, { status: 409 });
  }
  // "Book all" in one org leaves the other org's orders for their own run.
  const settlements = requested.filter((s) => orgOf(s) === scopeOrg);
  if ((deliveryOnly || settlementIds.length === 0) && lineOrg !== scopeOrg && settlements.length === 0) {
    return NextResponse.json({ error: "Nothing on this payout closes in this organisation." }, { status: 409 });
  }
  if (settlements.length === 0 && !deliveryOnly) {
    return NextResponse.json(
      { error: "No settlement records for this credit — run reconciliation again after the payout file upload." },
      { status: 400 },
    );
  }

  const runId = dryRun ? null : await ZohoPublishRunsRepository.start();
  try {
    const { results, wire, delivery } = await publishSettlements({
      line,
      settlements,
      accounts,
      inPayoutOrg: lineOrg === scopeOrg,
      referenceOverride: str(body.referenceNumberOverride) || undefined,
      dryRun,
      accessToken: await getAccessToken(),
      bookFeesOnExternallyPaid: body.bookFeesOnExternallyPaid === true,
      // A single-order Record never books the voucher's delivery charges, and
      // they belong to the payout's own org.
      includeDelivery: (deliveryOnly || settlementIds.length === 0) && lineOrg === scopeOrg,
      deliveryIntercompany,
    });
    if (runId) {
      await ZohoPublishRunsRepository.finish(
        runId,
        results.map((r) => ({
          ...r,
          error: r.ok ? undefined : r.message,
          paymentId: r.paymentId ?? undefined,
          needsManualReview: r.uncertain,
        })),
      );
    }
    return NextResponse.json({
      dryRun,
      results,
      // The bank's own cut on a cross-border wire, booked once for the whole
      // credit rather than smeared across its orders.
      wire,
      delivery,
      settlements: await SettlementsRepository.listByBankLineId(line.id),
      skippedOtherOrg: otherOrg.map((s) => s.order_number),
    });
  } catch (e) {
    if (runId) await ZohoPublishRunsRepository.finish(runId, [], (e as Error).message).catch(() => {});
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

function parseIntercompany(v: unknown): DeliveryIntercompanyAccounts {
  const out: DeliveryIntercompanyAccounts = {};
  if (!v || typeof v !== "object") return out;
  const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  for (const [org, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    out[org] = {
      dueFromAccountId: str(a.dueFromAccountId),
      expenseAccountId: str(a.expenseAccountId),
      dueToAccountId: str(a.dueToAccountId),
      vatTaxId: str(a.vatTaxId) || null,
      inputVatAccountId: str(a.inputVatAccountId) || null,
    };
  }
  return out;
}

// Multi-org: every Zoho call below runs in one organisation — `zohoOrg` when the
// drawer books orders picked into another company's books, else the payout's
// (lib/integrations/zoho-org.ts). handlePOST books only the orders in that org.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const b = (await req.clone().json().catch(() => ({}))) as { bankLineId?: unknown; zohoOrg?: unknown };
  const org = typeof b.zohoOrg === "string" && b.zohoOrg.trim() ? b.zohoOrg.trim() : await zohoOrgForBankLine(String(b.bankLineId ?? ""));
  return runInZohoOrgOr400(org, () => (handlePOST as (r: Request, c: unknown) => Promise<Response>)(req, ctx));
}
