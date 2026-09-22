import { NextResponse } from "next/server";
import { buildSalesLedger } from "@/lib/orders/sales-ledger.service";
import { buildDayWorkbook, buildMonthWorkbook } from "@/lib/orders/sales-ledger-xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/orders/sales-ledger/export?month=2026-09[&day=2026-09-14]
//
// .xlsx of the sales ledger: one day (the day drawer's orders, fees, net
// received and bank credits) or, without `day`, the whole month.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const dayRaw = (params.get("day") || "").trim();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayRaw) ? dayRaw : null;
  const monthRaw = (params.get("month") || "").trim();
  const month = day ? day.slice(0, 7) : /^\d{4}-(0[1-9]|1[0-2])$/.test(monthRaw) ? monthRaw : null;
  if (!month) return NextResponse.json({ error: "Pass month=YYYY-MM or day=YYYY-MM-DD" }, { status: 400 });

  try {
    const ledger = await buildSalesLedger(month);
    let buf: Buffer;
    let filename: string;
    if (day) {
      const d = ledger.days.find((x) => x.day === day);
      if (!d) return NextResponse.json({ error: `No such day in ${month}` }, { status: 404 });
      buf = await buildDayWorkbook(d);
      filename = `omnia-sales-${day}.xlsx`;
    } else {
      buf = await buildMonthWorkbook(ledger);
      filename = `omnia-sales-${month}.xlsx`;
    }
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
