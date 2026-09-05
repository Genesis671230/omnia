import { NextResponse } from "next/server";
import { PaymentSheetMonthsRepository } from "@/lib/repositories/payment-sheet-months.repository";

export async function DELETE(_req: Request, { params }: { params: Promise<{ monthKey: string }> }) {
  const { monthKey } = await params;
  await PaymentSheetMonthsRepository.remove(monthKey);
  return NextResponse.json({ ok: true });
}
