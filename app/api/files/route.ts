import { NextResponse } from "next/server";
import { FilesRepository } from "@/lib/repositories/files.repository";

// GET /api/files — every uploaded bank statement + payout file, newest first.
export async function GET() {
  try {
    const files = await FilesRepository.list();
    return NextResponse.json({ files });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
