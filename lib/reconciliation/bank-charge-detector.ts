import type { BankTxnLine } from "@/components/finance/reconciliation/bank-txn-row";

export type BankChargeDraft = {
  bankLineIds: string[];       // 1 line (SWIFT) or 2 lines (base + VAT)
  reference: string;
  date: string;
  amount: number;              // total; if inclusive, Zoho splits into base + VAT
  isInclusiveTax: boolean;
  taxId: string | null;        // Standard VAT 5% tax_id (null when no VAT)
  taxRate: number;             // 5 or 0
  categoryAccountId: string;   // Bank Fees and Charges
  paidThroughAccountId: string;
  description: string;
  placeOfSupply: string;
  taxTreatment: "vat_registered";
  confidence: "ready" | "needs_review";
  reasons: string[];
};

export type BankChargeSettings = {
  bankAccountId: string;
  bankChargesAccountId: string;
  vatStandard5Id: string;
  placeOfSupply?: string;      // Zoho Books UAE uses codes like "DU"
};

// Does `smaller` equal 5% of `larger` after 2dp rounding? Written as integer math
// to avoid FP surprises on values like 0.0245.
function isFivePercentPair(smaller: number, larger: number): boolean {
  const expectedVatFils = Math.round(larger * 5);       // 5% × 100
  return Math.abs(smaller * 100 - expectedVatFils) <= 1; // ±1 fils tolerance
}

const FEE_KEYWORDS = /swift|charges|fee|comm|remit|\bvat\b|\btt\b/i;

export function detectBankChargeDrafts(
  lines: BankTxnLine[],
  settings: BankChargeSettings,
): BankChargeDraft[] {
  const debits = lines.filter(
    (l) => l.direction === "debit" && (l.reference?.trim().length ?? 0) > 0,
  );

  const byRef = new Map<string, BankTxnLine[]>();
  for (const l of debits) {
    const key = l.reference!.trim();
    const bucket = byRef.get(key);
    if (bucket) bucket.push(l);
    else byRef.set(key, [l]);
  }


  const mappingReady = Boolean(settings.bankChargesAccountId && settings.bankAccountId);
  const drafts: BankChargeDraft[] = [];

  for (const [ref, group] of byRef) {
    // A single-line ref is almost always the transfer itself, not a fee.
    if (group.length < 2) continue;

    const items = group.map((l) => ({ line: l, abs: Math.abs(l.amount) }));
    const used = new Set<string>();

    // Pass 1: (base charge, 5% VAT) pairs → one tax-inclusive expense.
    for (let i = 0; i < items.length; i++) {
      if (used.has(items[i].line.id)) continue;
      for (let j = i + 1; j < items.length; j++) {
        if (used.has(items[j].line.id)) continue;
        const [smaller, larger] = items[i].abs < items[j].abs
          ? [items[i].abs, items[j].abs]
          : [items[j].abs, items[i].abs];
        if (!isFivePercentPair(smaller, larger)) continue;

        const total = Math.round((smaller + larger) * 100) / 100;
        drafts.push({
          bankLineIds: [items[i].line.id, items[j].line.id],
          reference: ref,
          date: items[i].line.date || items[j].line.date || "",
          amount: total,
          isInclusiveTax: true,
          taxId: settings.vatStandard5Id || null,
          taxRate: 5,
          categoryAccountId: settings.bankChargesAccountId,
          paidThroughAccountId: settings.bankAccountId,
          description: `Bank charges + 5% VAT · ref ${ref}`,
          placeOfSupply: settings.placeOfSupply ?? "DU",
          taxTreatment: "vat_registered",
          confidence: mappingReady && settings.vatStandard5Id ? "ready" : "needs_review",
          reasons: [`paired ${larger.toFixed(2)} base + ${smaller.toFixed(2)} VAT (5%)`],
        });
        used.add(items[i].line.id);
        used.add(items[j].line.id);
        break;
      }
    }

    // Pass 2: unpaired fee-like debits (SWIFT etc.) → one non-VAT expense.
    for (const { line, abs } of items) {
      if (used.has(line.id)) continue;
      if (!FEE_KEYWORDS.test(line.description || "")) continue;
      drafts.push({
        bankLineIds: [line.id],
        reference: ref,
        date: line.date || "",
        amount: Math.round(abs * 100) / 100,
        isInclusiveTax: false,
        taxId: null,
        taxRate: 0,
        categoryAccountId: settings.bankChargesAccountId,
        paidThroughAccountId: settings.bankAccountId,
        description: (line.description || `Bank fee · ref ${ref}`).slice(0, 100),
        placeOfSupply: settings.placeOfSupply ?? "DU",
        taxTreatment: "vat_registered",
        confidence: mappingReady ? "ready" : "needs_review",
        reasons: ["standalone fee (no VAT partner in reference group)"],
      });
      used.add(line.id);
    }
  }

  return drafts;
}