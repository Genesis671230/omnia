// Delete a bank line's booking from Zoho, from the Bank Transactions tab —
// so a wrong posting is fixed here (delete, then post again) instead of in
// Zoho and a Refresh.
//
// Only entries proven to be THIS line's money are deletable: one this app
// posted for it, or one the ledger Refresh matched by the bank ref. A
// "possible match" (same amount, no ref) is refused — it may be unrelated
// money (01 Sep: a 29 Aug sister-company transfer). An entry booked for
// several lines together (charge + VAT as one 1.05) clears all of them, and
// the plan names them so the confirmation can say so.

import { supabase } from "@/lib/supabase";
import { getAccessToken } from "@/lib/integrations/zoho";
import { zohoBooksBase, zohoOrgId, currentZohoScope } from "@/lib/integrations/zoho-context";
import { zohoThrottledFetch } from "@/lib/integrations/zoho-throttle";
import { BankLineZohoStatusRepository, ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type EntryKind = "banktransaction" | "expense" | "vendorpayment";

/** How Zoho undoes an entry depends on how it got into the books
 *  (bank-transactions.yml):
 *   manually_added → DELETE the transaction (or the expense / vendor payment)
 *   categorized    → POST /banktransactions/:id/uncategorize — the bank-feed
 *                    line goes back to uncategorised; DELETE is refused
 *   matched        → POST /banktransactions/:id/unmatch — the feed line is
 *                    freed; the document it was matched to stays in Zoho */
export type UndoAction = "delete" | "uncategorize" | "unmatch";

export function undoActionFor(zohoStatus: string | null | undefined): UndoAction {
  if (zohoStatus === "categorized") return "uncategorize";
  if (zohoStatus === "matched") return "unmatch";
  return "delete";
}

export type DeleteTarget = {
  zohoId: string;
  kind: EntryKind;
  reference: string;
  amount: number | null;
  /** Other bank lines this same Zoho entry is booked for. */
  siblingLineIds: string[];
  zohoStatus: string;
  action: UndoAction;
  source: "posted_by_app" | "ledger";
};

export type DeletePlan = { bankLineId: string; targets: DeleteTarget[]; refusal: string | null };

function kindFor(transactionType: string | null | undefined): EntryKind {
  if (transactionType === "expense") return "expense";
  if (transactionType === "vendor_payment") return "vendorpayment";
  return "banktransaction";
}

export async function planZohoEntryDelete(bankLineId: string): Promise<DeletePlan> {
  const [posting, [ledger]] = await Promise.all([
    ZohoBankTxnRepository.getPosting(bankLineId),
    BankLineZohoStatusRepository.list([bankLineId]),
  ]);
  const targets = new Map<string, DeleteTarget>();

  if (posting && posting.status !== "failed" && posting.zoho_transaction_id) {
    targets.set(posting.zoho_transaction_id, {
      zohoId: posting.zoho_transaction_id, kind: kindFor(posting.transaction_type), reference: posting.reference_number ?? "",
      amount: Number(posting.amount), siblingLineIds: [], source: "posted_by_app",
      zohoStatus: posting.zoho_status || "manually_added", action: undoActionFor(posting.zoho_status || "manually_added"),
    });
  }
  if (ledger?.state === "in_zoho") {
    for (const id of ledger.zoho_transaction_ids ?? []) {
      if (targets.has(id)) continue;
      targets.set(id, {
        zohoId: id, kind: kindFor(ledger.zoho_type), reference: ledger.zoho_reference ?? "",
        amount: ledger.zoho_amount == null ? null : Number(ledger.zoho_amount), siblingLineIds: [], source: "ledger",
        zohoStatus: ledger.zoho_status ?? "", action: undoActionFor(ledger.zoho_status),
      });
    }
  }

  if (!targets.size) {
    const refusal = ledger?.state === "possible_match"
      ? "Its bank reference isn't in Zoho — the same-amount entry nearby may be different money, so it can't be deleted from here. Delete it in Zoho if it's wrong."
      : "Nothing in Zoho is booked for this line.";
    return { bankLineId, targets: [], refusal };
  }

  // Lines sharing an entry (charge + VAT booked as one).
  for (const t of targets.values()) {
    // zoho_transaction_ids is jsonb — containment takes a JSON array literal.
    const { data, error } = await supabase
      .from("bank_line_zoho_status").select("bank_line_id").filter("zoho_transaction_ids", "cs", JSON.stringify([t.zohoId])).neq("bank_line_id", bankLineId);
    if (error) throw new Error(`bank_line_zoho_status read failed: ${error.message}`);
    t.siblingLineIds = (data ?? []).map((r) => r.bank_line_id as string);
  }
  return { bankLineId, targets: [...targets.values()], refusal: null };
}

const PATH: Record<EntryKind, string> = { banktransaction: "banktransactions", expense: "expenses", vendorpayment: "vendorpayments" };

async function zohoDelete(kind: EntryKind, id: string, token: string): Promise<{ ok: boolean; gone: boolean; message: string }> {
  return zohoCall("DELETE", `/${PATH[kind]}/${encodeURIComponent(id)}`, token);
}

async function zohoCall(method: "DELETE" | "POST", path: string, token: string, query: Record<string, string> = {}): Promise<{ ok: boolean; gone: boolean; message: string }> {
  const qs = new URLSearchParams({ organization_id: zohoOrgId(), ...query });
  const res = await zohoThrottledFetch(`${zohoBooksBase()}${path}?${qs}`, {
    method, headers: { Authorization: `Zoho-oauthtoken ${token}` }, cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
  const ok = res.ok && (json.code === undefined || json.code === 0);
  // Already deleted in Zoho counts as done.
  const gone = res.status === 404 || /does not exist|not found|invalid .*id/i.test(json.message ?? "");
  return { ok, gone, message: `Zoho ${method} ${path}: ${json.message ?? `HTTP ${res.status}`} (code ${json.code ?? "—"})` };
}

async function audit(plan: DeletePlan, t: DeleteTarget, actor: string) {
  await supabase.from("zoho_entry_deletions").insert({
    tenant_id: TENANT, bank_line_id: plan.bankLineId, zoho_connection_id: currentZohoScope()?.connectionId ?? "",
    zoho_entry_id: t.zohoId, zoho_entry_kind: t.action === "delete" ? t.kind : `${t.kind}:${t.action}`, zoho_reference: t.reference,
    amount: t.amount, sibling_line_ids: t.siblingLineIds, deleted_by: actor,
  });
}

export type DeleteResult = { deleted: DeleteTarget[]; failed: { target: DeleteTarget; error: string }[]; clearedLineIds: string[] };

/** Deletes every target of the plan in Zoho (the caller has scoped the org). */
export async function executeZohoEntryDelete(plan: DeletePlan, actor = "founder", bankAccountId = ""): Promise<DeleteResult> {
  const token = await getAccessToken();
  const deleted: DeleteTarget[] = [];
  const failed: { target: DeleteTarget; error: string }[] = [];

  const undone: string[] = [];
  for (const t of plan.targets) {
    if (t.action !== "delete") {
      const r = await zohoCall("POST", `/banktransactions/${encodeURIComponent(t.zohoId)}/${t.action}`, token, bankAccountId ? { account_id: bankAccountId } : {});
      if (r.ok) {
        deleted.push(t);
        undone.push(t.zohoId);
        await audit(plan, t, actor);
      } else failed.push({ target: t, error: r.message });
      continue;
    }
    let r = await zohoDelete(t.kind, t.zohoId, token);
    // A ledger row's type can mislead (an expense booked from the feed is a
    // bank transaction id) — try the bank-transaction endpoint before giving up.
    if (!r.ok && !r.gone && t.kind !== "banktransaction") {
      const alt = await zohoDelete("banktransaction", t.zohoId, token);
      if (alt.ok || alt.gone) r = alt;
      else r = { ...r, message: `${r.message} · ${alt.message}` };
    }
    if (r.ok || r.gone) {
      deleted.push(t);
      await audit(plan, t, actor);
    } else {
      failed.push({ target: t, error: r.message });
    }
  }

  // The line (and lines that shared a deleted entry) are no longer booked:
  // drop this app's posting record and mark the ledger status not found, so
  // the line can be posted again straight away — no Refresh needed.
  const cleared = new Set<string>();
  if (deleted.length && !failed.length) cleared.add(plan.bankLineId);
  for (const t of deleted) for (const s of t.siblingLineIds) cleared.add(s);
  const ids = [...cleared];
  if (ids.length) {
    const { error: e1 } = await supabase.from("zoho_bank_txn_postings").delete().in("bank_line_id", ids);
    if (e1) throw new Error(`Deleted in Zoho, but clearing the posting record failed: ${e1.message}`);
    // Uncategorised / unmatched lines are still in Zoho's bank feed, just not
    // booked; deleted ones are gone.
    const { error: e2 } = await supabase.from("bank_line_zoho_status").update({
      state: undone.length ? "uncategorized" : "not_found", match_kind: null, zoho_transaction_ids: undone,
      zoho_reference: null, zoho_amount: null, zoho_type: null, zoho_account: null,
      zoho_status: undone.length ? "uncategorized" : null, zoho_date: null, checked_at: new Date().toISOString(),
    }).in("bank_line_id", ids);
    if (e2) throw new Error(`Deleted in Zoho, but updating the line's status failed: ${e2.message}`);
  }
  return { deleted, failed, clearedLineIds: ids };
}
