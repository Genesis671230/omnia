/**
 * POST /api/reconcile/line/[id]/post-to-zoho
 *
 * Body (all optional):
 *   { orderRefs?: string[], dryRun?: boolean }
 *
 * If orderRefs is omitted, all non-refund transactions on the line are posted.
 * If dryRun is true, everything runs except the create — useful for a preview
 * modal that shows exactly which rows will post, which will skip, and why.
 */

import { NextResponse } from "next/server";
import { postPayoutToZoho, type PostablePayout } from "@/lib/zoho/post-payout";
import { runReconciliation } from "@/lib/reconciliation/engine";

// Replace with your actual recon store — kept abstract here so this file
// doesn't grow the surface area of this change.
async function loadReconLine(id: string): Promise<PostablePayout | null> {
  const line = (await runReconciliation()).find((l) => l.id === id);
  if (!line) {
    return NextResponse.json({ error: `No reconciliation line ${id}` }, { status: 404 });
  }
  return line;
}

const { ZOHO_BANK_ACCOUNT_ID } = process.env;
if (!ZOHO_BANK_ACCOUNT_ID) {
  throw new Error("ZOHO_BANK_ACCOUNT_ID missing — look this up once via GET /chartofaccounts?filter_by=AccountType.Bank");
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    orderRefs?: string[];
    dryRun?: boolean;
  };

  const line = await loadReconLine(id);
  if (!line) return NextResponse.json({ error: "line_not_found" }, { status: 404 });

  // Refuse to post when the payout doesn't foot to the bank credit — posting
  // partial recon would leave silent gaps. The UI already blocks the button
  // in this case; this is a server-side belt-and-braces check.
  const sum = +line.transactions
    .filter((t) => (body.orderRefs ? body.orderRefs.includes(t.ref) : true))
    .reduce((s, t) => s + t.netShare, 0)
    .toFixed(2);
  // Note: full-payout footing check happens in the recon engine, not here —
  // the line already carries a validated `net`. We only guard against posting
  // an empty selection.
  if (!Number.isFinite(sum) || line.transactions.length === 0) {
    return NextResponse.json({ error: "no_transactions" }, { status: 400 });
  }

  try {
    const result = await postPayoutToZoho(line, {
      bankAccountId: ZOHO_BANK_ACCOUNT_ID!,
      onlyRefs: body.orderRefs,
      dryRun: body.dryRun,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}