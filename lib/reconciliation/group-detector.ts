import type { BankTxnLine } from "@/components/finance/reconciliation/bank-txn-row";

export type BankLineGroup = {
  key: string;               // stable id — the reference number
  reference: string;
  date: string;
  mainLine: BankTxnLine;     // the actual transfer (largest non-fee debit)
  feeLines: BankTxnLine[];   // fee/VAT siblings that BankChargesPanel posts separately
  allLines: BankTxnLine[];
  totalAmount: number;       // sum of absolute values across the group
  payee: string;             // extracted from mainLine.description
};

// SIB fee-line signatures — anything matching these belongs to the existing
// bank-charges flow, not the group-classification flow.
const FEE_KEYWORDS = /^(fees?\s+or\s+charges|tax\s+amount\s+payable|correspondent\s+bank\s+charges|outward\s+swift\s+charges|account\s+transfer\s+charges)/i;

function isFeeLine(l: BankTxnLine): boolean {
  return FEE_KEYWORDS.test((l.description || "").trim());
}

// SIB narration is slash-delimited; extract the counterparty name from the
// three shapes we see in practice. Falls back to empty if none match.
export function extractPayee(narration: string): string {
  const s = narration || "";
  const patterns = [
    /Outward Telex Payment\/([^\/]+)\//i,                    // domestic wires — most common
    /Ben Info:[^,]*,\s*([^\/]+?)(?:\/|,)/i,                  // intl wires (Ben Info header)
    /Trans Debit\/([A-Z][^\/]+?)\/(?:SW|TOF|PS|IBMB)/i,      // internal transfers (Omnia Mohamed etc.)
  ];
  for (const rx of patterns) {
    const m = s.match(rx);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

export function groupBankLines(lines: BankTxnLine[]): BankLineGroup[] {
  const byRef = new Map<string, BankTxnLine[]>();
  for (const l of lines) {
    const key = (l.reference || "").trim();
    if (!key) continue;
    const bucket = byRef.get(key);
    if (bucket) bucket.push(l);
    else byRef.set(key, [l]);
  }

  const groups: BankLineGroup[] = [];
  for (const [ref, groupLines] of byRef) {
    const debits = groupLines.filter((l) => l.direction === "debit");
    if (!debits.length) continue; // credit-only groups (gateway payouts) stay in the existing flow

    const fees = debits.filter(isFeeLine);
    const nonFees = debits.filter((l) => !isFeeLine(l));

    // Main = largest non-fee debit. Fees-only groups shouldn't occur but if they
    // do we still pick the biggest so the row renders instead of crashing.
    const candidates = nonFees.length ? nonFees : fees;
    const mainLine = candidates.reduce((a, b) =>
      Math.abs(a.amount) > Math.abs(b.amount) ? a : b,
    );

    groups.push({
      key: ref,
      reference: ref,
      date: mainLine.date || debits[0].date || "",
      mainLine,
      feeLines: fees,
      allLines: groupLines,
      totalAmount: debits.reduce((s, l) => s + Math.abs(l.amount), 0),
      payee: extractPayee(mainLine.description),
    });
  }

  return groups.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}