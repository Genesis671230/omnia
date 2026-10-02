import { NextResponse } from "next/server";
import { runInZohoOrgOr400, zohoOrgForBankLine } from "@/lib/integrations/zoho-org";
import { zohoConfigured } from "@/lib/integrations/zoho";
import { executeZohoEntryDelete, planZohoEntryDelete } from "@/lib/finance/zoho-entry-delete";
import { accountsForLines, getStatementAccount } from "@/lib/finance/statement-accounts";

export const maxDuration = 60;

// GET    /api/bank-lines/:id/zoho-entry → { plan } — what a delete would remove
//        (entries, amounts, other lines sharing them), or why it can't.
// DELETE /api/bank-lines/:id/zoho-entry → { deleted, failed, clearedLineIds }
//        Deletes this line's booking in its own books (SIB → Omniastores,
//        RAK → House of Omnia). The plan is rebuilt server-side; the client
//        only says which line.
async function plan(id: string) {
  return planZohoEntryDelete(id);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json({ plan: await plan(id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  return runInZohoOrgOr400(await zohoOrgForBankLine(id), async () => {
    try {
      const p = await plan(id);
      if (p.refusal) return NextResponse.json({ error: p.refusal, plan: p }, { status: 409 });
      // uncategorize / unmatch take the bank account the line sits in.
      const acctId = (await accountsForLines([id])).get(id);
      const acct = acctId ? await getStatementAccount(acctId) : null;
      const result = await executeZohoEntryDelete(p, "founder", acct?.zohoAccountId ?? "");
      const status = result.failed.length && !result.deleted.length ? 502 : 200;
      return NextResponse.json({ ...result, error: result.failed.map((f) => f.error).join(" · ") || undefined }, { status });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  });
}
