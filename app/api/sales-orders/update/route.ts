import { NextResponse } from "next/server";
import { saveEdit, type SoEdit } from "@/lib/sales-orders/so-close.service";
import type { BatchPick } from "@/lib/sales-orders/zoho-so";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/sales-orders/update
//   { month, order, edit: SoEdit, close?: boolean, batches?: {line_item_id: BatchPick[]}, invoiceDate?, sheet?, confirm: true }
//   Live Zoho write: saves the edited sales order; with close, also confirms,
//   invoices (dated per Settings unless invoiceDate is given) and marks sent.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { month?: string; order?: string; edit?: SoEdit; close?: boolean; batches?: Record<string, BatchPick[]>; invoiceDate?: string; sheet?: string; confirm?: boolean };
  if (body.confirm !== true) return NextResponse.json({ error: "confirm: true is required — this writes to Zoho" }, { status: 400 });
  if (!body.month || !/^\d{4}-\d{2}$/.test(body.month) || !body.order || !body.edit) return NextResponse.json({ error: "month, order and edit are required" }, { status: 400 });
  try {
    return NextResponse.json(await saveEdit(body.month, body.order, body.edit, { close: Boolean(body.close), batches: body.batches, invoiceDate: body.invoiceDate, sheet: body.sheet }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
