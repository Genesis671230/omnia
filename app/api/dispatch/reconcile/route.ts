import { NextResponse } from "next/server";
import { buildThreeWay } from "@/lib/dispatch/three-way.service";
import { threeWayXlsx } from "@/lib/dispatch/three-way-xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/dispatch/reconcile?from=&to=[&fresh=1][&format=xlsx]
//   Store orders vs Zoho invoices (stored index) vs the dispatch sheet (live,
//   cached 1 min). No Zoho call. format=xlsx downloads the workbook.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || from > to) return NextResponse.json({ error: "from and to (YYYY-MM-DD) are required" }, { status: 400 });
  try {
    const data = await buildThreeWay(from, to, sp.get("fresh") === "1");
    if (sp.get("format") === "xlsx") {
      const buf = await threeWayXlsx(data.rows, data.summary, `${from} to ${to}`, data.sheetSources);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="dispatch-reconciliation-${from}-to-${to}.xlsx"`,
        },
      });
    }
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
