import { NextResponse } from "next/server";
import { buildMonthManagementReport } from "@/lib/reports/management-report.service";
import { managementReportXlsx } from "@/lib/reports/management-report-xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/reports/management?month=YYYY-MM[&format=xlsx]
//   The month for management: placed → cancelled → gross → refunds → net,
//   received vs receivable (by where it's stuck and age), refunds by order
//   month and by payout month, exchanges, per gateway, per order, issues.
//   No Zoho calls (stored indexes); dispatch sheets cached a minute.
const MONTH = /^\d{4}-\d{2}$/;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const month = sp.get("month") ?? "";
  if (!MONTH.test(month)) return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  try {
    const report = await buildMonthManagementReport(month);
    if (sp.get("format") === "xlsx") {
      return new NextResponse(new Uint8Array(await managementReportXlsx(report)), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="sales-report-${month}.xlsx"`,
        },
      });
    }
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
