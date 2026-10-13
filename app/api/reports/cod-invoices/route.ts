import { NextResponse } from "next/server";
import { buildMonthCodReport } from "@/lib/reports/cod-invoice-report.service";
import { codInvoiceReportXlsx } from "@/lib/reports/cod-invoice-report-xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/reports/cod-invoices?month=YYYY-MM[&fresh=1][&format=xlsx]
//   Every COD order of the month with its Zoho invoice (House of Omnia),
//   its status there, the courier voucher and what to do. Zoho read cached 10 min.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const month = sp.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  try {
    const report = await buildMonthCodReport(month, { fresh: sp.get("fresh") === "1" });
    if (sp.get("format") === "xlsx") {
      return new NextResponse(new Uint8Array(await codInvoiceReportXlsx(report)), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="cod-invoices-${month}.xlsx"`,
        },
      });
    }
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
