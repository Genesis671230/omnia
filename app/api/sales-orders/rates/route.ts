import { NextResponse } from "next/server";
import { soSettings } from "@/lib/sales-orders/so-close.service";

export const dynamic = "force-dynamic";

// GET → { rates: { SAR: 0.98, … } } — the fixed AED rates foreign orders are
// closed at in Zoho (Settings → salesorders.fixed_rates). Read-only, for the
// orders list; the full settings API is admin-only.
export async function GET() {
  return NextResponse.json({ rates: (await soSettings()).rules.rates });
}
