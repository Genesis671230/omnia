import { NextResponse } from "next/server";
import { listStatementAccounts, saveStatementAccount } from "@/lib/finance/statement-accounts";
import { listZohoConnections } from "@/lib/integrations/zoho-org";

export const dynamic = "force-dynamic";

// GET  /api/statement-accounts → { accounts, orgs }
// POST /api/statement-accounts { id?, label, bank?, kind?, holder?, zohoConnectionId?, zohoAccountId?, matchHints? }
//   Adds or edits one account (SIB, RAK, a credit card…). Which Zoho books
//   and which Zoho bank/card account its lines post into lives here.
export async function GET() {
  try {
    const [accounts, conns] = await Promise.all([listStatementAccounts(), listZohoConnections().catch(() => [])]);
    // The main organisation's connection id is "env"; accounts store it as ''.
    const orgs = conns.filter((c) => c.status !== "disabled").map((c) => ({ id: c.id === "env" ? "" : c.id, label: c.label }));
    return NextResponse.json({ accounts, orgs });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.id && !String(body.label ?? "").trim()) return NextResponse.json({ error: "Give the account a name." }, { status: 400 });
  if (body.kind !== undefined && body.kind !== "bank" && body.kind !== "credit_card") {
    return NextResponse.json({ error: "kind must be bank or credit_card" }, { status: 400 });
  }
  try {
    const account = await saveStatementAccount({
      id: body.id ? String(body.id) : undefined,
      label: body.label !== undefined ? String(body.label) : undefined,
      bank: body.bank !== undefined ? String(body.bank) : undefined,
      kind: body.kind as "bank" | "credit_card" | undefined,
      holder: body.holder !== undefined ? String(body.holder) : undefined,
      zohoConnectionId: body.zohoConnectionId !== undefined ? String(body.zohoConnectionId) : undefined,
      zohoAccountId: body.zohoAccountId !== undefined ? String(body.zohoAccountId) : undefined,
      matchHints: Array.isArray(body.matchHints) ? body.matchHints.map(String) : undefined,
    });
    return NextResponse.json({ account });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
