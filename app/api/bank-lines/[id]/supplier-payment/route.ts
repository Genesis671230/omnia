import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { runInZohoOrgOr400, zohoOrgForBankLine } from "@/lib/integrations/zoho-org";
import { zohoConfigured } from "@/lib/integrations/zoho";
import {
  createVendorPayment, findVendorPaymentByReference, listOpenBills, ZohoScopeError, ZohoVendorRejection,
} from "@/lib/integrations/zoho-vendors";
import { checkAllocation, supplierPaymentReference } from "@/lib/finance/supplier-payment";
import { BankLineZohoStatusRepository, ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";

export const maxDuration = 60;

// POST /api/bank-lines/:id/supplier-payment[?zohoOrg=…]
//   { vendorId, vendorName, amount, applied: { [billId]: amount },
//     paidThroughAccountId, description?, dryRun? }
// Books a bank debit (or any part of it) as a Zoho vendor payment: applied to
// the supplier's bills as given, the rest left on the supplier as an advance.
// Bills are re-read from Zoho before writing; a payment with this debit's
// reference is looked up first, so a retry never pays twice.
async function handlePOST(req: Request, bankLineId: string) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as {
    vendorId?: string; vendorName?: string; amount?: number; applied?: Record<string, number>;
    paidThroughAccountId?: string; description?: string; dryRun?: boolean;
  };
  const vendorId = String(body.vendorId ?? "").trim();
  const paidThrough = String(body.paidThroughAccountId ?? "").trim();
  if (!vendorId) return NextResponse.json({ error: "Pick the supplier." }, { status: 400 });
  if (!paidThrough) return NextResponse.json({ error: "Pick the bank account the money left from." }, { status: 400 });

  const { data: line, error } = await supabase
    .from("bank_lines").select("id, statement_date, amount, direction, reference, description").eq("id", bankLineId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!line) return NextResponse.json({ error: `No bank line ${bankLineId}` }, { status: 404 });
  if (line.direction !== "debit") return NextResponse.json({ error: "Only money going out can pay a supplier." }, { status: 400 });

  const existing = await ZohoBankTxnRepository.getPosting(bankLineId);
  if (existing && existing.status !== "failed" && existing.transaction_type !== "vendor_payment") {
    return NextResponse.json({ error: `This debit is already booked in Zoho as ${existing.transaction_type} (${existing.zoho_transaction_id}).` }, { status: 409 });
  }
  // Same double-entry guard as account postings: a line the last Refresh found
  // in the Zoho ledger (booked by the accountant) is never paid again here.
  const [ledger] = await BankLineZohoStatusRepository.list([bankLineId]);
  if (ledger?.state === "in_zoho" && existing?.transaction_type !== "vendor_payment") {
    return NextResponse.json({ error: `Already in Zoho as "${ledger.zoho_reference}" (AED ${Number(ledger.zoho_amount).toFixed(2)}) — not paid again. Refresh if it was deleted in Zoho.` }, { status: 409 });
  }

  try {
    const bills = await listOpenBills(vendorId);
    const applied = Object.fromEntries(Object.entries(body.applied ?? {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
    const check = checkAllocation({ amount: Number(body.amount), bankAmount: Math.abs(Number(line.amount)), bills, applied });
    if (!check.ok) return NextResponse.json({ error: check.errors.join(" "), check }, { status: 400 });

    const reference = supplierPaymentReference(line.reference, bankLineId, vendorId);
    const found = await findVendorPaymentByReference(reference);
    if (found) return NextResponse.json({ status: "found_existing", paymentId: found, reference, check });

    const date = String(line.statement_date).slice(0, 10);
    const description = (body.description?.trim() ||
      `Payment to ${body.vendorName || "supplier"} · bank ${line.reference || ""}${check.advance > 0 ? ` · AED ${check.advance.toFixed(2)} advance` : ""}`).slice(0, 500);
    if (body.dryRun) return NextResponse.json({ status: "planned", reference, check, date, description });

    const paymentId = await createVendorPayment({
      vendorId, amount: Number(body.amount), date, paidThroughAccountId: paidThrough, reference, description,
      bills: Object.entries(applied).map(([billId, amount]) => ({ billId, amount })),
    });
    // The bank line's Zoho posting: one per debit. category_account_id carries
    // the vendor here — a vendor payment has no category account.
    await ZohoBankTxnRepository.recordPosting({
      bank_line_id: bankLineId, direction: "debit", transaction_type: "vendor_payment", category_account_id: vendorId,
      reference_number: reference, amount: Number(body.amount), zoho_transaction_id: paymentId, zoho_status: "",
      status: "posted", error: "", posted_by: "founder",
    });
    return NextResponse.json({ status: "booked", paymentId, reference, check });
  } catch (e) {
    if (e instanceof ZohoScopeError) return NextResponse.json({ error: e.message, scope: e.scope }, { status: 403 });
    if (e instanceof ZohoVendorRejection) return NextResponse.json({ error: e.message }, { status: 422 });
    return NextResponse.json({ error: `${(e as Error).message} — Zoho may not have answered; retrying is safe, it looks the payment up by reference first.` }, { status: 502 });
  }
}

// The books are the bank line's own statement account's (SIB → Omniastores,
// RAK → House of Omnia) — never whatever the client asked for.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runInZohoOrgOr400(await zohoOrgForBankLine(id), () => handlePOST(req, id));
}
