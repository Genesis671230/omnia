// The description a bank line carries into Zoho Books.
//
// The bank's own narration ("FTS CTD Cr Account Transfer/NETWORK INTERNATIONAL
// LLC/…/REF/AEL2609020004017 … SHOPIFY- ROMA1MQ…/ FT26245BWF4X") is what the
// matcher reads and must never be replaced. On top of it a person can add an
// extra description — pre-filled with what the app already knows (gateway,
// payout, orders, counterparty, references) — so the Zoho entry says what the
// money was without anyone decoding the narration. Pure: no I/O, no Zoho calls.

export type BankLineFacts = {
  direction: "credit" | "debit";
  amount: number;
  date: string | null;
  narration: string;
  reference: string | null;
  /** Gateway/entity the classifier or bank import named (e.g. "Tabby"). */
  entity?: string | null;
  /** Classifier kind (gateway_transfer, expense, refund…). */
  kind?: string | null;
  /** The gateway payout reconciliation matched to this credit, if any. */
  payout?: { id: string; gateway: string; orders: string[] } | null;
};

export type NarrationParts = { channel: string | null; counterparty: string | null; gatewayRef: string | null; merchantTag: string | null };

const MERCHANTS = /(SHOPIFY|TABBY|TAMARA|STRIPE|TELR|CHECKOUT|SMSA|ARAMEX)[-\s]*([A-Z0-9]{6,})?/i;

/** Pull the parts a person cares about out of a UAE bank narration. */
export function parseNarration(narration: string): NarrationParts {
  const text = (narration || "").replace(/\s+/g, " ").trim();
  const segs = text.split("/").map((s) => s.trim());
  const channel = segs[0] || null;
  // "…Transfer/<COUNTERPARTY>/<address>…" — the counterparty is the first
  // segment after the channel that reads like a name, not an address or code.
  const counterparty = segs.slice(1).find((s) => /[A-Z]{3,}/i.test(s) && !/^(OFFICE|PO|BOX|P\.O|AE|UAE|DUBAI|REF)\b/i.test(s) && s.length <= 60) ?? null;
  const gatewayRef = /\/REF\/([A-Z0-9]{6,})/i.exec(text)?.[1] ?? null;
  const m = MERCHANTS.exec(text);
  const merchantTag = m ? `${m[1].toUpperCase()}${m[2] ? ` ${m[2]}` : ""}` : null;
  return { channel, counterparty, gatewayRef, merchantTag };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-02…" → "02 Sep 2026". By hand: toLocaleDateString gives "Sept"
 *  on the server and "Sep" in some browsers, and the text must not differ. */
const fmtDate = (d: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? "");
  if (!m) return d ? d.slice(0, 10) : null;
  return `${m[3]} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
};
const fmtAed = (n: number) => `AED ${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const KIND_LABEL: Record<string, string> = {
  expense: "Expense",
  refund: "Refund",
  owner_contribution: "Owner contribution",
  owner_drawing: "Owner drawing",
  interest_income: "Interest income",
  deposit: "Deposit",
};

/** The pre-filled extra description: everything the app knows, in one line. */
export function defaultBankLineNote(f: BankLineFacts): string {
  const n = parseNarration(f.narration);
  const parts: string[] = [];
  const gw = f.payout?.gateway || f.entity || null;

  if (f.direction === "credit") {
    parts.push(gw ? `${gw} payout received` : f.kind && KIND_LABEL[f.kind] ? KIND_LABEL[f.kind] : "Credit received");
  } else {
    const what = f.kind && KIND_LABEL[f.kind] ? KIND_LABEL[f.kind] : "Payment";
    parts.push(gw ? `${what}: ${gw}` : what);
  }
  parts.push(fmtAed(f.amount));
  if (n.counterparty) parts.push(`${f.direction === "credit" ? "from" : "to"} ${n.counterparty}`);
  if (f.payout) {
    const k = f.payout.orders.length;
    parts.push(`payout ${f.payout.id}${k ? ` (${k} order${k === 1 ? "" : "s"}: ${f.payout.orders.slice(0, 6).map((o) => `#${o}`).join(", ")}${k > 6 ? ` +${k - 6}` : ""})` : ""}`);
  }
  if (n.gatewayRef) parts.push(`gateway ref ${n.gatewayRef}`);
  if (n.merchantTag && !f.payout) parts.push(n.merchantTag);
  if (f.reference) parts.push(`bank ref ${f.reference}`);
  const d = fmtDate(f.date);
  if (d) parts.push(d);
  return parts.join(" · ");
}

/** Zoho's bank-transaction description is capped; journals use 500 too. */
export const ZOHO_DESCRIPTION_MAX = 500;

/** What reaches Zoho: the extra description first (it's what a person reads),
 *  then the bank's own narration, trimmed so the total fits. */
export function zohoDescriptionFor(extra: string | null | undefined, narration: string): string {
  const note = (extra ?? "").trim();
  const bank = (narration ?? "").replace(/\s+/g, " ").trim();
  if (!note) return bank.slice(0, ZOHO_DESCRIPTION_MAX);
  if (!bank || note.includes(bank)) return note.slice(0, ZOHO_DESCRIPTION_MAX);
  const joined = `${note} | Bank: ${bank}`;
  return joined.length <= ZOHO_DESCRIPTION_MAX ? joined : `${joined.slice(0, ZOHO_DESCRIPTION_MAX - 1)}…`;
}
