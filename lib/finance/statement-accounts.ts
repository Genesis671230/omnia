// Which bank / card account a statement belongs to — and so which Zoho books
// its lines post into. SIB (Omniastores), RAK (House of Omnia) and a card
// statement are separate accounts: separate lists, separate dedupe, separate
// Zoho organisations. Table: statement_accounts (db/schema.sql).

import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

/** Lines imported before accounts existed are all the Omniastores SIB export. */
export const LEGACY_ACCOUNT = "sib-omniastores";

export type StatementAccount = {
  id: string;
  label: string;
  bank: string;
  kind: "bank" | "credit_card";
  holder: string;
  /** '' = the main Zoho organisation. */
  zohoConnectionId: string;
  /** The Zoho bank / credit-card account these lines leave from or land in. */
  zohoAccountId: string;
  matchHints: string[];
  currency: string;
};

type Row = {
  id: string; label: string; bank: string; kind: string; holder: string; zoho_connection_id: string;
  zoho_account_id: string; match_hints: string[] | null; currency: string; sort: number;
};

const fromRow = (r: Row): StatementAccount => ({
  id: r.id, label: r.label, bank: r.bank, kind: r.kind === "credit_card" ? "credit_card" : "bank", holder: r.holder,
  zohoConnectionId: r.zoho_connection_id, zohoAccountId: r.zoho_account_id, matchHints: r.match_hints ?? [], currency: r.currency,
});

export async function listStatementAccounts(): Promise<StatementAccount[]> {
  const { data, error } = await supabase.from("statement_accounts").select("*").eq("tenant_id", TENANT).order("sort").order("created_at");
  if (error) throw new Error(`statement_accounts read failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(fromRow);
}

export async function getStatementAccount(id: string): Promise<StatementAccount | null> {
  const { data, error } = await supabase.from("statement_accounts").select("*").eq("tenant_id", TENANT).eq("id", id).maybeSingle();
  if (error) throw new Error(`statement_accounts read failed: ${error.message}`);
  return data ? fromRow(data as Row) : null;
}

export function slugForAccount(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "account";
}

export async function saveStatementAccount(a: Partial<StatementAccount> & { id?: string; label?: string }): Promise<StatementAccount> {
  const id = a.id || slugForAccount(a.label ?? "");
  const patch: Record<string, unknown> = { id, tenant_id: TENANT };
  if (a.label !== undefined) patch.label = a.label.trim();
  if (a.bank !== undefined) patch.bank = a.bank.trim();
  if (a.kind !== undefined) patch.kind = a.kind;
  if (a.holder !== undefined) patch.holder = a.holder.trim();
  if (a.zohoConnectionId !== undefined) patch.zoho_connection_id = a.zohoConnectionId;
  if (a.zohoAccountId !== undefined) patch.zoho_account_id = a.zohoAccountId;
  if (a.matchHints !== undefined) patch.match_hints = a.matchHints.map((h) => h.trim()).filter(Boolean);
  // An edit touches only the fields given; a new account needs its name.
  const exists = Boolean(a.id) && Boolean(await getStatementAccount(id));
  if (!exists && !a.label?.trim()) throw new Error("Give the account a name.");
  const { data, error } = exists
    ? await supabase.from("statement_accounts").update(patch).eq("tenant_id", TENANT).eq("id", id).select("*").single()
    : await supabase.from("statement_accounts").insert(patch).select("*").single();
  if (error) throw new Error(`statement_accounts save failed: ${error.message}`);
  return fromRow(data as Row);
}

/** The account a statement's own header names (account number, card mask,
 *  holder) — or null when nothing in it matches, so the uploader must pick. */
export function detectStatementAccount(text: string, accounts: StatementAccount[]): StatementAccount | null {
  const head = text.slice(0, 6000).toUpperCase().replace(/\s+/g, " ");
  const hits = accounts.filter((a) => a.matchHints.some((h) => h && head.includes(h.toUpperCase().replace(/\s+/g, " "))));
  return hits.length === 1 ? hits[0] : null;
}

/** Map bank-line ids → their statement account. */
export async function accountsForLines(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("bank_lines").select("id, statement_account").in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`bank_lines read failed: ${error.message}`);
    for (const r of data ?? []) out.set(r.id as string, (r.statement_account as string) || LEGACY_ACCOUNT);
  }
  return out;
}

