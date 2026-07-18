import { NextResponse } from "next/server";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";

// GET /api/settlements — feeds the Settlements panel: what still needs
// evidence, and what's confirmed and ready for the Zoho publish batch.
export async function GET() {
  const [unconfirmed, readyToPublish] = await Promise.all([
    SettlementsRepository.listUnconfirmed(),
    SettlementsRepository.listReadyToPublish(),
  ]);
  return NextResponse.json({ unconfirmed, readyToPublish });
}
