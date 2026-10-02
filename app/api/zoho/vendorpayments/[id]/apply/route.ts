import { NextResponse } from "next/server";
import { runInZohoOrgOr400 } from "@/lib/integrations/zoho-org";
import { zohoOrgForSupplierRequest } from "@/lib/integrations/zoho-org-request";
import { applyAdvanceToBills, getVendorPayment, listOpenBills, ZohoScopeError, ZohoVendorRejection } from "@/lib/integrations/zoho-vendors";

export const maxDuration = 60;

// POST /api/zoho/vendorpayments/:id/apply[?bankLine=…|?zohoOrg=…]
//   { applied: { [billId]: amount } }
// Applies an advance (the unused part of a supplier payment) to that
// supplier's open bills. Bills and the payment are re-read from Zoho first:
// every bill must be the same supplier's and owe at least what is applied.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { applied?: Record<string, number> };
  const add = Object.entries(body.applied ?? {})
    .map(([billId, v]) => ({ billId, amount: Math.round(Number(v) * 100) / 100 }))
    .filter((a) => a.amount > 0);
  if (!add.length) return NextResponse.json({ error: "Enter an amount on at least one bill." }, { status: 400 });

  return runInZohoOrgOr400(await zohoOrgForSupplierRequest(req), async () => {
    try {
      const payment = await getVendorPayment(id);
      const bills = await listOpenBills(payment.vendor_id);
      for (const a of add) {
        const bill = bills.find((b) => b.bill_id === a.billId);
        if (!bill) return NextResponse.json({ error: "A bill picked isn't an open bill of this supplier." }, { status: 400 });
        if (a.amount > bill.balance + 0.005) {
          return NextResponse.json({ error: `More than bill ${bill.bill_number} owes (AED ${bill.balance.toFixed(2)}).` }, { status: 400 });
        }
      }
      await applyAdvanceToBills(id, add);
      const after = await getVendorPayment(id);
      return NextResponse.json({ status: "applied", paymentId: id, unusedLeft: after.balance });
    } catch (e) {
      if (e instanceof ZohoScopeError) return NextResponse.json({ error: e.message, scope: e.scope }, { status: 403 });
      if (e instanceof ZohoVendorRejection) return NextResponse.json({ error: e.message }, { status: 422 });
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  });
}
