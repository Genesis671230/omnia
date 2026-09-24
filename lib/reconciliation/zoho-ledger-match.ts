// Which bank lines are already in the Zoho Books ledger — pure, so the rules
// can be tested against real Zoho rows without a network.
//
// Matching on the reference alone does not work, for two reasons seen in the
// live ledger (Sharjah Islamic Bank, 01 Sep 2026):
//
//   1. One bank ref covers several statement lines. FT26244T2HH8 is a 50,000
//      transfer, its 1.00 transfer charge AND the 0.05 VAT on that charge.
//      A map keyed by reference can only ever hold one of them.
//   2. The accountant types free text after the ref in Zoho —
//      "FT26244T2HH8-Trf to Credit card 50k on 01.09.2026" — so an exact
//      string comparison never matches.
//
// And the charge + VAT pair is booked in Zoho as ONE 1.05 expense, so a line
// can be "in Zoho" as part of a combined entry rather than on its own.
//
// So: match on the ref TOKEN, the direction, and the amount; then let the
// lines left over in a ref group sum into one remaining Zoho entry.

export type LedgerBankLine = {
  id: string;
  /** Statement date (YYYY-MM-DD…); only the amount+date fallback reads it. */
  date?: string | null;
  amount: number;
  direction: "credit" | "debit";
  reference: string | null;
  description: string;
};

export type LedgerZohoTxn = {
  transaction_id: string;
  date: string;
  amount: number;
  transaction_type: string;
  /** categorized | uncategorized | matched | excluded | manually_added */
  status: string;
  /** From the BANK ACCOUNT's side: "debit" = money in, "credit" = money out. */
  debit_or_credit: string;
  reference_number: string;
  offset_account_name?: string;
};

export type LedgerState = "in_zoho" | "uncategorized" | "amount_differs" | "not_found";

export type LedgerStatus = {
  state: LedgerState;
  matchKind: "exact" | "combined" | "posted_by_app" | "amount_date" | null;
  zohoTransactionIds: string[];
  zohoReference: string | null;
  zohoAmount: number | null;
  zohoType: string | null;
  zohoAccount: string | null;
  zohoStatus: string | null;
  zohoDate: string | null;
};

const EPS = 0.005;
const FALLBACK_DAYS = 3;
const MAX_SUBSET_LINES = 12;
export const APP_REFERENCE_PREFIX = "BANKLINE-";

/** Bank-ref-shaped tokens: 8+ letters/digits with at least one of each.
 *  Keeps FT26244T2HH8 / DSZ26244HHHBDFKF; drops free text ("Trf"), account
 *  numbers (0012043598001) and SWIFT codes (NRAKAEAKXXX). */
export function refTokens(s: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const t of (s ?? "").toUpperCase().split(/[^A-Z0-9]+/)) {
    if (t.length >= 8 && /[A-Z]/.test(t) && /\d/.test(t)) out.add(t);
  }
  return [...out];
}

/** Zoho's debit/credit is from the bank account's side; ours is the statement's. */
function zohoDirection(t: LedgerZohoTxn): "credit" | "debit" | null {
  if (t.debit_or_credit === "debit") return "credit"; // money into the bank
  if (t.debit_or_credit === "credit") return "debit"; // money out of the bank
  return null;
}

const isBooked = (t: LedgerZohoTxn) => t.status !== "uncategorized" && t.status !== "excluded";
const r2 = (n: number) => Math.round(n * 100) / 100;

function statusFrom(t: LedgerZohoTxn, matchKind: LedgerStatus["matchKind"], state?: LedgerState): LedgerStatus {
  return {
    state: state ?? (isBooked(t) ? "in_zoho" : "uncategorized"),
    matchKind,
    zohoTransactionIds: [t.transaction_id],
    zohoReference: t.reference_number || null,
    zohoAmount: r2(Number(t.amount)),
    zohoType: t.transaction_type || null,
    zohoAccount: t.offset_account_name || null,
    zohoStatus: t.status || null,
    zohoDate: t.date || null,
  };
}

const NOT_FOUND: LedgerStatus = {
  state: "not_found", matchKind: null, zohoTransactionIds: [], zohoReference: null,
  zohoAmount: null, zohoType: null, zohoAccount: null, zohoStatus: null, zohoDate: null,
};

/** Smallest subset (≥2 lines) of `lines` summing to `target`, or null. */
function subsetSumming(lines: LedgerBankLine[], target: number): LedgerBankLine[] | null {
  const n = Math.min(lines.length, MAX_SUBSET_LINES);
  let best: LedgerBankLine[] | null = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    const pick: LedgerBankLine[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { sum += lines[i].amount; pick.push(lines[i]); }
    if (pick.length >= 2 && Math.abs(sum - target) < EPS && (!best || pick.length < best.length)) best = pick;
  }
  return best;
}

export function matchBankLinesToZoho(
  lines: LedgerBankLine[],
  zohoTxns: LedgerZohoTxn[],
): Map<string, LedgerStatus> {
  const out = new Map<string, LedgerStatus>();
  const used = new Set<string>();

  // 1. Entries this app posted carry the line id itself — no guessing needed.
  const byAppId = new Map<string, LedgerZohoTxn>();
  for (const t of zohoTxns) {
    const ref = (t.reference_number ?? "").trim();
    if (ref.toUpperCase().startsWith(APP_REFERENCE_PREFIX)) byAppId.set(ref.slice(APP_REFERENCE_PREFIX.length).toLowerCase(), t);
  }
  for (const l of lines) {
    const t = byAppId.get(l.id.toLowerCase());
    if (t && !used.has(t.transaction_id)) {
      used.add(t.transaction_id);
      out.set(l.id, statusFrom(t, "posted_by_app"));
    }
  }

  // 2. Index Zoho by ref token + our direction.
  const index = new Map<string, LedgerZohoTxn[]>();
  for (const t of zohoTxns) {
    const dir = zohoDirection(t);
    if (!dir) continue;
    for (const tok of refTokens(t.reference_number)) {
      const key = `${tok}|${dir}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key)!.push(t);
    }
  }

  // 3. Group the still-unmatched lines by their primary ref token.
  const groups = new Map<string, LedgerBankLine[]>();
  for (const l of lines) {
    if (out.has(l.id)) continue;
    const toks = refTokens(l.reference);
    const tok = toks[0] ?? refTokens(l.description).at(-1);
    if (!tok) { out.set(l.id, NOT_FOUND); continue; }
    const key = `${tok}|${l.direction}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }

  for (const [key, group] of groups) {
    // Booked entries before bank-feed ones, so a line matches its booking
    // rather than the raw statement import of the same money.
    const candidates = () => (index.get(key) ?? [])
      .filter((t) => !used.has(t.transaction_id))
      .sort((a, b) => Number(isBooked(b)) - Number(isBooked(a)));

    // 3a. Exact amount, biggest lines first.
    const remaining: LedgerBankLine[] = [];
    for (const l of [...group].sort((a, b) => b.amount - a.amount)) {
      const t = candidates().find((c) => Math.abs(Number(c.amount) - l.amount) < EPS);
      if (t) { used.add(t.transaction_id); out.set(l.id, statusFrom(t, "exact")); }
      else remaining.push(l);
    }

    // 3b. Several lines booked as one entry (charge + VAT on it).
    for (const t of candidates()) {
      const left = remaining.filter((l) => !out.has(l.id));
      if (left.length < 2) break;
      const pick = subsetSumming(left, Number(t.amount));
      if (!pick) continue;
      used.add(t.transaction_id);
      for (const l of pick) out.set(l.id, statusFrom(t, "combined"));
    }

    // 3c. The ref is in Zoho but nothing adds up — say so, with Zoho's figure.
    for (const l of remaining) {
      if (out.has(l.id)) continue;
      const near = candidates().sort((a, b) => Math.abs(Number(a.amount) - l.amount) - Math.abs(Number(b.amount) - l.amount))[0];
      out.set(l.id, near ? { ...statusFrom(near, null, "amount_differs"), zohoTransactionIds: [] } : NOT_FOUND);
    }
  }

  // 4. The accountant sometimes books under a different ref (07 Sep: bank
  //    FT26250XYXNL, Zoho "FT26251PVCVF-Traf to Credit card 40K"). Accept a
  //    same-direction, same-amount entry within a few days — but only when it
  //    is the ONLY such entry, and its ref belongs to no bank line still
  //    waiting for a booking, so it cannot steal one. (That 40K entry carries
  //    the 08 Sep 300K transfer's ref — a slip in Zoho; the 300K and its
  //    charge + VAT are all matched, so the ref is no longer anyone's.)
  const lineTokens = new Set(
    lines.filter((l) => out.get(l.id)?.state !== "in_zoho").flatMap((l) => refTokens(l.reference)),
  );
  const free = zohoTxns.filter((t) =>
    !used.has(t.transaction_id) && isBooked(t) && zohoDirection(t) &&
    !refTokens(t.reference_number).some((tok) => lineTokens.has(tok)));
  const dayMs = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
  const near = (l: LedgerBankLine, t: LedgerZohoTxn) =>
    zohoDirection(t) === l.direction && Math.abs(Number(t.amount) - l.amount) < EPS &&
    Boolean(l.date && t.date) && Math.abs(dayMs(l.date!) - dayMs(t.date)) <= FALLBACK_DAYS * 86_400_000;
  const orphans = lines.filter((l) => out.get(l.id)?.state === "not_found");
  for (const l of orphans) {
    const cands = free.filter((t) => !used.has(t.transaction_id) && near(l, t));
    if (cands.length !== 1) continue;
    // …and no other orphan line could claim the same entry.
    if (orphans.some((o) => o.id !== l.id && out.get(o.id)?.state === "not_found" && near(o, cands[0]))) continue;
    used.add(cands[0].transaction_id);
    out.set(l.id, statusFrom(cands[0], "amount_date"));
  }

  return out;
}
