import { NextResponse } from "next/server";
import { buildAdminMoney, withCancelled } from "@/lib/dashboard/admin-money.service";
import { buildAdminMoneyWorkbook } from "@/lib/dashboard/admin-money-xlsx";
import { dubaiToday } from "@/lib/dubai-day";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/dashboard/admin-money/export?from=…&to=…[&gateway=Stripe]
// .xlsx of the Admin tab (Daily, By gateway, Orders, How to read). A gateway
// filter keeps only that gateway's orders, re-summed the same way.
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const today = dubaiToday();
  const from = p.get("from") || `${today.slice(0, 7)}-01`;
  const to = p.get("to") || today;
  const gateway = (p.get("gateway") || "").trim();
  try {
    let view = await buildAdminMoney(from, to);
    if (gateway) {
      const { byDay, byGateway, overdueByGateway, sumMoney } = await import("@/lib/dashboard/admin-money");
      const orders = view.orders.filter((o) => o.gateway === gateway);
      view = withCancelled({ ...view, orders, totals: sumMoney(orders), days: byDay(orders, view.days.map((d) => d.day)),
        gateways: byGateway(orders, view.terms), overdue: overdueByGateway(orders, view.terms) }, view.cancelled.filter((c) => c.gateway === gateway));
    }
    const buf = await buildAdminMoneyWorkbook(view);
    const name = `omnia-admin-money-${view.from}_${view.to}${gateway ? `-${gateway.replace(/\W+/g, "-")}` : ""}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
