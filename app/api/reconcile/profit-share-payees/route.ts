import { NextResponse } from "next/server";
import { PayeeRepository } from "@/lib/repositories/payee.repository";

export async function GET() {
  try {
    return NextResponse.json({ payees: await PayeeRepository.list() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.normalizedName || !body.equityAccountId) {
      return NextResponse.json({ error: "normalizedName + equityAccountId required" }, { status: 400 });
    }
    await PayeeRepository.upsert({
      normalized_name: String(body.normalizedName).toLowerCase().trim(),
      display_name: String(body.displayName ?? body.normalizedName),
      equity_account_id: String(body.equityAccountId),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const name = new URL(request.url).searchParams.get("name");
    if (!name) return NextResponse.json({ error: "name query param required" }, { status: 400 });
    await PayeeRepository.remove(name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}