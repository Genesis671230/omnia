import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { listZohoBankTransactions } from "@/lib/integrations/zoho-books-banking";
import { ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";

export const maxDuration = 120;

export async function GET(request: Request) {
    if (!zohoConfigured()) {
      return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
    }
  
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId") || undefined;
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
  
    const accessToken = await getAccessToken();
    const zohoTxns = await listZohoBankTransactions({ accountId, dateStart: from, dateEnd: to }, accessToken);
    const norm = (s?: string | null) => (s ?? "").trim().toUpperCase();

    const byReference = new Map(
      zohoTxns.filter((t) => t.reference_number).map((t) => [norm(t.reference_number), t])
    );
    
  
    const localPostings = await ZohoBankTxnRepository.listPostings({ from, to });
    const toCheck = localPostings.filter((p) => p.status === "posted" || p.status === "verified" || p.status === "missing_in_zoho");
  
    let verified = 0;
    let missing = 0;
  
    for (const p of toCheck) {
      const match = byReference.get(norm(p.reference_number));
            if (match) {
        await ZohoBankTxnRepository.markVerified(p.bank_line_id, {
          zoho_transaction_id: match.transaction_id,
          zoho_status: match.status,
        });
        verified++;
      } else {
        await ZohoBankTxnRepository.markMissingInZoho(p.bank_line_id);
        missing++;
      }
    }
  
    return NextResponse.json({ checked: toCheck.length, verified, missing, syncedAt: new Date().toISOString() });
   
}