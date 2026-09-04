import { NextRequest, NextResponse } from "next/server";
import { buildWorkbenchInvoices, defaultWorkbenchFrom } from "@/lib/finance/build-workbench-invoices";
import type { ZohoInvoiceStatus } from "@/lib/finance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const from = p.get("from") ?? defaultWorkbenchFrom();
  const to = p.get("to") ?? new Date().toISOString().slice(0, 10);
  const status = (p.get("status") ?? "unpaid") as ZohoInvoiceStatus | "all";

  try {
    const response = await buildWorkbenchInvoices({ from, to, status });
    return NextResponse.json(response);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
