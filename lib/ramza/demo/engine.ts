/* The RAMZA instant demo — runs entirely in the visitor's browser.
 *
 *   gateway payout lines ──match──▶ invoices / orders   (by reference, then amount)
 *        │ fee + VAT on fee split out, foreign currency converted to AED
 *        ▼
 *   payout net ──match──▶ bank credit   (the gap is the exchange difference)
 *        ▼
 *   journal: Dr Bank, Dr Fees, Dr VAT input, Dr/Cr FX ─ Cr Gateway clearing
 *
 * Plus the other tools: bank-statement categorisation to a chart of accounts,
 * payroll + gratuity, and an e-invoice field check. Demo data is generated
 * from a fixed seed per industry, so every visitor sees the same month. */

import { categorise, chartFor, type Account, type Industry } from "./coa";
import { ALIASES, col, day, detectKind, num, type FileKind, type Table } from "./csv";

/* ── rates & gateway terms (illustrative, labelled as such in the UI) ── */

export const FX_TO_AED: Record<string, number> = { AED: 1, USD: 3.6725, SAR: 0.9793, KWD: 11.95, QAR: 1.0089, OMR: 9.54, BHD: 9.74, EUR: 3.98, GBP: 4.66 };
const VAT = 0.05;

type GatewayTerms = { pct: number; fixed: number; vatOnFee: boolean; settleDays: number; payoutCcy?: string };
export const GATEWAY_TERMS: Record<string, GatewayTerms> = {
  "Shopify Payments": { pct: 0.029, fixed: 1, vatOnFee: true, settleDays: 3 },
  Stripe: { pct: 0.029, fixed: 1, vatOnFee: false, settleDays: 7 },
  Tabby: { pct: 0.045, fixed: 1, vatOnFee: true, settleDays: 7 },
  Tamara: { pct: 0.05, fixed: 0, vatOnFee: true, settleDays: 7 },
  Telr: { pct: 0.0275, fixed: 1, vatOnFee: true, settleDays: 5 },
  "Network International": { pct: 0.0185, fixed: 0, vatOnFee: true, settleDays: 1 },
  "COD courier": { pct: 0, fixed: 15, vatOnFee: true, settleDays: 7 },
  "Bank transfer": { pct: 0, fixed: 0, vatOnFee: false, settleDays: 0 },
};

/* ── shapes ── */

export type Invoice = { number: string; date: string; customer: string; currency: string; total: number; trn?: string; buyerTrn?: string; address?: string; lines?: number; taxAmount?: number };
export type PayoutLine = { payoutId: string; gateway: string; date: string; ref: string; currency: string; gross: number; fee: number; vat: number; net: number; kind: "sale" | "refund"; customerHint?: string };
export type BankLine = { date: string; description: string; amount: number };
export type Employee = { name: string; basic: number; allowances: number; joined: string };

export type Dataset = {
  industry: Industry;
  month: string;
  company: string;
  invoices: Invoice[];
  payouts: PayoutLine[];
  bank: BankLine[];
  employees: Employee[];
};

/* ── seeded demo data ── */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

const PROFILES: Record<Industry, {
  company: string; prefix: string; seed: number; count: number; min: number; max: number;
  mix: [string, number, string?][]; customers: string[]; expenses: [string, number][]; staff: number;
}> = {
  ecommerce: {
    company: "Sahara Bloom Boutique LLC", prefix: "SB", seed: 11, count: 64, min: 120, max: 2400,
    mix: [["Shopify Payments", 0.36], ["Tabby", 0.22], ["Tamara", 0.12], ["Stripe", 0.14, "USD"], ["Tabby", 0.06, "SAR"], ["COD courier", 0.1]],
    customers: ["Mariam A.", "Fatima K.", "Noura S.", "Aisha M.", "Hessa R.", "Layla H.", "Sara B.", "Reem J.", "Dana T.", "Amna F."],
    expenses: [["META PLATFORMS ADS", -4200], ["GOOGLE ADS 4421", -1350], ["ARAMEX COURIER OCT", -2875], ["SHOPIFY* SUBSCRIPTION", -295], ["DEWA BILL 2026-10", -640], ["PACKAGING BOXES ALMAS TRADING", -1180], ["ETISALAT BUSINESS", -399], ["WPS SALARY OCT", -24500], ["BANK CHARGES OCT", -52.5]],
    staff: 4,
  },
  logistics: {
    company: "Falcon Route Logistics FZ-LLC", prefix: "FR", seed: 23, count: 48, min: 350, max: 6800,
    mix: [["Bank transfer", 0.55], ["COD courier", 0.25], ["Network International", 0.2]],
    customers: ["Najm Electronics", "Oud Majestic", "Desert Pets", "Bloom Florals", "Gulf Spares", "Petal & Co", "Atlas Pharma"],
    expenses: [["ENOC FUEL CARD OCT", -8900], ["SALIK TOP-UP", -1500], ["RTA VEHICLE RENEWAL", -2350], ["WPS SALARY OCT", -61200], ["GDRFA VISA RENEWAL", -3870], ["AC SERVICE WAREHOUSE", -650], ["DU BUSINESS", -499], ["SUBCONTRACT DRIVERS ALPHA", -12400], ["BANK CHARGES OCT", -78.75]],
    staff: 9,
  },
  realestate: {
    company: "Marina Keys Property Management LLC", prefix: "MK", seed: 37, count: 36, min: 4500, max: 38000,
    mix: [["Bank transfer", 0.7], ["Stripe", 0.15], ["Telr", 0.15]],
    customers: ["Unit 1204 — Al Mansoori", "Unit 905 — R. Khan", "Villa 17 — Patel", "Unit 2201 — Smith", "Shop G03 — Café Lune", "Unit 708 — Haddad"],
    expenses: [["DEWA COMMON AREA", -5400], ["EMPOWER CHILLER", -7200], ["MAINTENANCE PLUMBING CO", -2300], ["EJARI REGISTRATION", -220], ["META ADS LISTINGS", -1800], ["WPS SALARY OCT", -38400], ["AUDIT FEES QTR", -4500], ["BANK CHARGES OCT", -64]],
    staff: 6,
  },
  wholesale: {
    company: "Golden Grain Trading LLC", prefix: "GG", seed: 41, count: 40, min: 2500, max: 48000,
    mix: [["Bank transfer", 0.8], ["Stripe", 0.1, "USD"], ["Network International", 0.1]],
    customers: ["Al Noor Supermarket", "Spice Route Rest.", "Coral Hypermarket", "Bay Cafés", "Emirates Catering", "Oasis Mini Mart"],
    expenses: [["DUBAI CUSTOMS DUTY", -14200], ["FREIGHT FORWARDER MAERSK", -9800], ["WAREHOUSE RENT JAFZA", -18000], ["WPS SALARY OCT", -42000], ["ENOC FUEL", -2100], ["ZOHO BOOKS", -260], ["BANK CHARGES OCT", -91.25]],
    staff: 7,
  },
  retail: {
    company: "Corniche Optics LLC", prefix: "CO", seed: 53, count: 70, min: 90, max: 1900,
    mix: [["Network International", 0.62], ["Tabby", 0.18], ["Bank transfer", 0.2]],
    customers: ["Walk-in", "Walk-in", "Walk-in", "Corporate — ADNOC staff", "Walk-in", "Insurance — Daman"],
    expenses: [["MALL RENT Q4", -32000], ["DEWA SHOP", -1450], ["WPS SALARY OCT", -27600], ["META ADS", -1600], ["ETISALAT POS LINE", -199], ["STATIONERY OFFICE", -240], ["BANK CHARGES OCT", -45]],
    staff: 5,
  },
  construction: {
    company: "Al Barsha Build Contracting LLC", prefix: "AB", seed: 67, count: 18, min: 45000, max: 420000,
    mix: [["Bank transfer", 1]],
    customers: ["Emaar Projects — Tower B", "Villa Owner — Al Furjan", "Nakheel — Retail Pod", "Private Client — Jumeirah"],
    expenses: [["READYMIX CONCRETE", -86000], ["STEEL REBAR SUPPLY", -142000], ["SUBCONTRACT MEP WORKS", -98000], ["CRANE EQUIPMENT HIRE", -36000], ["WPS SALARY OCT", -188000], ["MUNICIPALITY PERMIT", -4200], ["ENOC FUEL", -6400], ["BANK CHARGES OCT", -150]],
    staff: 24,
  },
};

export function demoDataset(industry: Industry, month = "2026-10"): Dataset {
  const p = PROFILES[industry];
  const rand = rng(p.seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const pickGw = () => {
    let x = rand();
    for (const m of p.mix) { x -= m[1]; if (x <= 0) return m; }
    return p.mix[0];
  };
  const invoices: Invoice[] = [];
  const payouts: PayoutLine[] = [];
  const trn = "100" + String(Math.floor(rand() * 1e12)).padStart(12, "0");
  for (let i = 0; i < p.count; i++) {
    const d = 1 + Math.floor(rand() * 24);
    const date = `${month}-${pad(d)}`;
    const [gateway, , ccy = "AED"] = pickGw();
    const totalAed = r2(p.min + rand() * (p.max - p.min));
    const total = ccy === "AED" ? totalAed : r2(totalAed / FX_TO_AED[ccy]);
    const number = `${p.prefix}${1040 + i}`;
    const b2b = industry !== "ecommerce" && industry !== "retail";
    invoices.push({
      number, date, customer: pick(p.customers), currency: ccy, total,
      trn, buyerTrn: b2b && rand() > 0.25 ? "100" + String(Math.floor(rand() * 1e12)).padStart(12, "0") : undefined,
      address: rand() > 0.12 ? "Dubai, UAE" : undefined, lines: 1 + Math.floor(rand() * 4), taxAmount: r2(total - total / 1.05),
    });
    // A few invoices are still unpaid at month end; one is short-paid.
    if (rand() < 0.08) continue;
    const t = GATEWAY_TERMS[gateway];
    // Construction clients hold back 10% retention on progress certificates.
    const gross = industry === "construction" && rand() < 0.7 ? r2(total * 0.9) : rand() < 0.03 ? r2(total * 0.6) : total;
    const fee = r2(gross * t.pct + (t.fixed / FX_TO_AED[ccy]));
    const vat = t.vatOnFee ? r2(fee * VAT) : 0;
    const settle = Math.min(28, d + t.settleDays);
    payouts.push({
      // A bank transfer is its own "payout" — the customer's reference is on the credit.
      payoutId: gateway === "Bank transfer" ? number : `${gateway.split(" ")[0].toUpperCase()}-${ccy}-${month.replace("-", "")}${pad(settle)}`,
      gateway, date: `${month}-${pad(settle)}`, ref: number, currency: ccy, gross, fee, vat, net: r2(gross - fee - vat), kind: "sale",
      customerHint: gateway === "Bank transfer" ? invoices[invoices.length - 1].customer.toUpperCase().slice(0, 18) : undefined,
    });
  }
  // One refund inside a payout.
  const refundOf = payouts.find((x) => x.gateway !== "Bank transfer" && x.gateway !== "COD courier");
  if (refundOf) payouts.push({ ...refundOf, ref: refundOf.ref, gross: -r2(refundOf.gross * 0.5), fee: 0, vat: 0, net: -r2(refundOf.gross * 0.5), kind: "refund" });

  // Bank: one credit per payout (foreign payouts land at the bank's own rate),
  // direct transfers as their own credits, then the month's expenses.
  const bank: BankLine[] = [];
  for (const [id, lines] of groupBy(payouts, (x) => x.payoutId)) {
    const l0 = lines[0];
    const net = lines.reduce((a, x) => a + x.net, 0);
    const bankRate = FX_TO_AED[l0.currency] * (l0.currency === "AED" ? 1 : 0.985 + rand() * 0.01);
    const desc = l0.gateway === "Bank transfer" ? `IPI TRANSFER ${l0.customerHint ?? ""} REF ${id}`.replace(/\s+/g, " ")
      : l0.gateway === "COD courier" ? `COD REMITTANCE ARAMEX ${id}` : `${l0.gateway.toUpperCase()} PAYOUT ${id}`;
    bank.push({ date: l0.date, description: desc, amount: r2(net * bankRate) });
  }
  for (const [desc, amt] of p.expenses) bank.push({ date: `${month}-${pad(2 + Math.floor(rand() * 26))}`, description: desc, amount: amt });
  bank.sort((a, b) => a.date.localeCompare(b.date));

  const names = ["Ahmed R.", "Priya N.", "Joseph M.", "Omar S.", "Grace L.", "Bilal K.", "Ravi P.", "Hana Y.", "Ali T.", "Sofia D."];
  const employees: Employee[] = Array.from({ length: Math.min(p.staff, 10) }, (_, i) => ({
    name: names[i], basic: Math.round(3000 + rand() * 9000), allowances: Math.round(1500 + rand() * 4000),
    joined: `${2018 + Math.floor(rand() * 8)}-${pad(1 + Math.floor(rand() * 12))}-01`,
  }));

  return { industry, month, company: p.company, invoices, payouts, bank, employees };
}

function groupBy<T>(xs: T[], k: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(k(x), [...(m.get(k(x)) ?? []), x]);
  return m;
}

/* ── reconciliation ── */

export type MatchStatus = "matched" | "short_paid" | "retention" | "unmatched_payout" | "unpaid_invoice" | "refund";
export type MatchRow = {
  ref: string; gateway: string; date: string; currency: string; status: MatchStatus;
  invoice: Invoice | null; payoutId: string | null;
  grossAed: number; feeAed: number; vatAed: number; netAed: number; invoiceAed: number; diffAed: number;
};
export type PayoutSummary = {
  payoutId: string; gateway: string; date: string; currency: string; lines: number;
  grossAed: number; feeAed: number; vatAed: number; netAed: number; bank: BankLine | null; fxAed: number;
};
export type JournalLine = { ref: string; date: string; account: string; debit: number; credit: number; memo: string };
export type ReconResult = {
  company: string;
  rows: MatchRow[];
  payouts: PayoutSummary[];
  journal: JournalLine[];
  gateways: { gateway: string; lines: number; grossAed: number; feeAed: number; vatAed: number; netAed: number; effectiveRate: number }[];
  summary: {
    invoices: number; cleared: number; shortPaid: number; retention: number; retentionAed: number; unpaid: number; unmatchedPayouts: number; refunds: number;
    grossAed: number; feeAed: number; vatAed: number; fxAed: number; netAed: number; bankAed: number; currencies: string[];
    payouts: number; bankMatched: number; minutesSaved: number; matchRate: number;
  };
};

const aed = (v: number, ccy: string) => r2(v * (FX_TO_AED[ccy.toUpperCase()] ?? 1));
const refKey = (s: string) => s.toUpperCase().replace(/^#/, "").replace(/\s+/g, "");

export function reconcile(ds: Pick<Dataset, "company" | "invoices" | "payouts" | "bank">): ReconResult {
  const invByRef = new Map(ds.invoices.map((i) => [refKey(i.number), i]));
  const usedInv = new Set<string>();
  const rows: MatchRow[] = [];

  for (const p of ds.payouts) {
    const inv = invByRef.get(refKey(p.ref)) ?? findByAmount(ds.invoices, p, usedInv);
    const grossAed = aed(p.gross, p.currency), feeAed = aed(p.fee, p.currency), vatAed = aed(p.vat, p.currency), netAed = aed(p.net, p.currency);
    if (p.kind === "refund") {
      rows.push({ ref: p.ref, gateway: p.gateway, date: p.date, currency: p.currency, status: "refund", invoice: inv ?? null, payoutId: p.payoutId, grossAed, feeAed, vatAed, netAed, invoiceAed: 0, diffAed: 0 });
      continue;
    }
    if (inv) usedInv.add(inv.number);
    const invoiceAed = inv ? aed(inv.total, inv.currency) : 0;
    const diff = inv ? r2(invoiceAed - grossAed) : 0;
    rows.push({
      ref: p.ref, gateway: p.gateway, date: p.date, currency: p.currency,
      status: !inv ? "unmatched_payout" : Math.abs(diff) <= Math.max(1, invoiceAed * 0.01) ? "matched"
        : diff > 0 && Math.abs(diff / invoiceAed - 0.1) < 0.005 ? "retention" : "short_paid",
      invoice: inv ?? null, payoutId: p.payoutId, grossAed, feeAed, vatAed, netAed, invoiceAed, diffAed: diff,
    });
  }
  for (const i of ds.invoices) {
    if (usedInv.has(i.number)) continue;
    rows.push({ ref: i.number, gateway: "—", date: i.date, currency: i.currency, status: "unpaid_invoice", invoice: i, payoutId: null, grossAed: 0, feeAed: 0, vatAed: 0, netAed: 0, invoiceAed: aed(i.total, i.currency), diffAed: aed(i.total, i.currency) });
  }

  // Payouts → bank: a credit with the payout id / gateway name, closest amount within 3%.
  const usedBank = new Set<number>();
  const payouts: PayoutSummary[] = [];
  for (const [id, lines] of groupBy(ds.payouts, (x) => x.payoutId)) {
    const l0 = lines[0];
    const grossAed = r2(lines.reduce((a, x) => a + aed(x.gross, x.currency), 0));
    const feeAed = r2(lines.reduce((a, x) => a + aed(x.fee, x.currency), 0));
    const vatAed = r2(lines.reduce((a, x) => a + aed(x.vat, x.currency), 0));
    const netAed = r2(lines.reduce((a, x) => a + aed(x.net, x.currency), 0));
    let bi = ds.bank.findIndex((b, i) => !usedBank.has(i) && b.amount > 0 && b.description.toUpperCase().includes(id.toUpperCase()));
    if (bi < 0 && l0.gateway === "Bank transfer") bi = ds.bank.findIndex((b, i) => !usedBank.has(i) && b.amount > 0 && Math.abs(b.amount - netAed) < 0.02);
    if (bi < 0) {
      const gw = l0.gateway.split(" ")[0].toUpperCase();
      let best = -1, gap = Infinity;
      ds.bank.forEach((b, i) => {
        if (usedBank.has(i) || b.amount <= 0 || !b.description.toUpperCase().includes(gw)) return;
        const g = Math.abs(b.amount - netAed);
        if (g < gap && g <= netAed * 0.03) { gap = g; best = i; }
      });
      bi = best;
    }
    const bank = bi >= 0 ? ds.bank[bi] : null;
    if (bi >= 0) usedBank.add(bi);
    payouts.push({ payoutId: id, gateway: l0.gateway, date: l0.date, currency: l0.currency, lines: lines.length, grossAed, feeAed, vatAed, netAed, bank, fxAed: bank ? r2(netAed - bank.amount) : 0 });
  }
  payouts.sort((a, b) => a.date.localeCompare(b.date));

  const journal: JournalLine[] = [];
  for (const p of payouts) {
    if (!p.bank) continue;
    const memo = `${p.gateway} payout ${p.payoutId} · ${p.lines} line${p.lines > 1 ? "s" : ""}`;
    journal.push({ ref: p.payoutId, date: p.bank.date, account: "Bank — current account", debit: p.bank.amount, credit: 0, memo });
    if (p.feeAed) journal.push({ ref: p.payoutId, date: p.bank.date, account: "Payment processing fees", debit: p.feeAed, credit: 0, memo });
    if (p.vatAed) journal.push({ ref: p.payoutId, date: p.bank.date, account: "VAT input (recoverable)", debit: p.vatAed, credit: 0, memo });
    if (p.fxAed > 0) journal.push({ ref: p.payoutId, date: p.bank.date, account: "Exchange loss", debit: p.fxAed, credit: 0, memo: `${p.currency} → AED at the bank's rate` });
    if (p.fxAed < 0) journal.push({ ref: p.payoutId, date: p.bank.date, account: "Exchange gain", debit: 0, credit: -p.fxAed, memo: `${p.currency} → AED at the bank's rate` });
    journal.push({ ref: p.payoutId, date: p.bank.date, account: p.gateway === "Bank transfer" ? "Accounts receivable" : "Gateway clearing", debit: 0, credit: p.grossAed, memo });
  }

  const gateways = [...groupBy(rows.filter((r) => r.payoutId), (r) => r.gateway)].map(([gateway, rs]) => {
    const grossAed = r2(rs.reduce((a, r) => a + r.grossAed, 0));
    const feeAed = r2(rs.reduce((a, r) => a + r.feeAed, 0));
    const vatAed = r2(rs.reduce((a, r) => a + r.vatAed, 0));
    return { gateway, lines: rs.length, grossAed, feeAed, vatAed, netAed: r2(rs.reduce((a, r) => a + r.netAed, 0)), effectiveRate: grossAed > 0 ? (feeAed + vatAed) / grossAed : 0 };
  }).sort((a, b) => b.grossAed - a.grossAed);

  const sales = rows.filter((r) => r.payoutId && r.status !== "refund");
  // Retention is settled as far as this month goes: the invoice is paid less the agreed hold-back.
  const cleared = rows.filter((r) => r.status === "matched" || r.status === "retention").length;
  const s = {
    invoices: ds.invoices.length,
    cleared,
    shortPaid: rows.filter((r) => r.status === "short_paid").length,
    retention: rows.filter((r) => r.status === "retention").length,
    retentionAed: r2(rows.filter((r) => r.status === "retention").reduce((a, r) => a + r.diffAed, 0)),
    unpaid: rows.filter((r) => r.status === "unpaid_invoice").length,
    unmatchedPayouts: rows.filter((r) => r.status === "unmatched_payout").length,
    refunds: rows.filter((r) => r.status === "refund").length,
    grossAed: r2(rows.filter((r) => r.payoutId).reduce((a, r) => a + r.grossAed, 0)),
    feeAed: r2(rows.reduce((a, r) => a + r.feeAed, 0)),
    vatAed: r2(rows.reduce((a, r) => a + r.vatAed, 0)),
    fxAed: r2(payouts.reduce((a, p) => a + p.fxAed, 0)),
    netAed: r2(rows.filter((r) => r.payoutId).reduce((a, r) => a + r.netAed, 0)),
    bankAed: r2(payouts.reduce((a, p) => a + (p.bank?.amount ?? 0), 0)),
    currencies: [...new Set(ds.payouts.map((p) => p.currency))],
    payouts: payouts.length,
    bankMatched: payouts.filter((p) => p.bank).length,
    // ~1.5 min per line matched by hand in a spreadsheet, the industry rule of thumb.
    minutesSaved: Math.round((sales.length + payouts.length) * 1.5),
    matchRate: ds.invoices.length ? cleared / ds.invoices.length : 0,
  };
  return { company: ds.company, rows, payouts, journal, gateways, summary: s };
}

function findByAmount(invoices: Invoice[], p: PayoutLine, used: Set<string>): Invoice | undefined {
  const g = aed(p.gross, p.currency);
  return invoices.find((i) => !used.has(i.number) && Math.abs(aed(i.total, i.currency) - g) < 0.05 && Math.abs(Date.parse(p.date) - Date.parse(i.date)) <= 14 * 86_400_000);
}

/* ── bank statement → chart of accounts ── */

export type CategorisedLine = BankLine & { account: Account; confidence: "rule" | "fallback"; vatAed: number };
export function categoriseBank(bank: BankLine[], chart: Account[]): { lines: CategorisedLine[]; byAccount: { account: Account; count: number; total: number; vatAed: number }[]; autoRate: number } {
  const lines = bank.map((b) => {
    const c = categorise(b.description, b.amount, chart);
    // Recoverable VAT inside a VAT-able expense (5/105 of the gross).
    const vatAed = c.vatRecoverable && b.amount < 0 ? r2((-b.amount * VAT) / (1 + VAT)) : 0;
    return { ...b, account: c.account, confidence: c.confidence, vatAed };
  });
  const by = new Map<string, { account: Account; count: number; total: number; vatAed: number }>();
  for (const l of lines) {
    const e = by.get(l.account.code) ?? { account: l.account, count: 0, total: 0, vatAed: 0 };
    e.count += 1; e.total = r2(e.total + l.amount); e.vatAed = r2(e.vatAed + l.vatAed);
    by.set(l.account.code, e);
  }
  return { lines, byAccount: [...by.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total)), autoRate: lines.length ? lines.filter((l) => l.confidence === "rule").length / lines.length : 0 };
}

/* ── payroll & gratuity (UAE Labour Law, Federal Decree-Law 33/2021) ── */

export type PayrollRow = Employee & { gross: number; years: number; gratuity: number; monthlyAccrual: number };
/** Gratuity: 21 days' basic per year for the first 5 years, 30 days per year after,
 *  pro-rata, only after 1 year of service, capped at 2 years' total wage. Estimate. */
export function gratuity(basic: number, allowances: number, joined: string, asOf: string): { years: number; amount: number } {
  const years = Math.max(0, (Date.parse(asOf) - Date.parse(joined)) / (365.25 * 86_400_000));
  if (years < 1) return { years: r2(years), amount: 0 };
  const daily = basic / 30;
  const amount = daily * (21 * Math.min(years, 5) + 30 * Math.max(years - 5, 0));
  return { years: r2(years), amount: r2(Math.min(amount, (basic + allowances) * 24)) };
}
export function payroll(employees: Employee[], asOf: string): { rows: PayrollRow[]; totals: { gross: number; basic: number; gratuity: number; monthlyAccrual: number } } {
  const rows = employees.map((e) => {
    const g = gratuity(e.basic, e.allowances, e.joined, asOf);
    const next = gratuity(e.basic, e.allowances, e.joined, new Date(Date.parse(asOf) + 30.44 * 86_400_000).toISOString().slice(0, 10));
    return { ...e, gross: e.basic + e.allowances, years: g.years, gratuity: g.amount, monthlyAccrual: r2(Math.max(next.amount - g.amount, 0)) };
  });
  const sum = (k: "gross" | "basic" | "gratuity" | "monthlyAccrual") => r2(rows.reduce((a, r) => a + r[k], 0));
  return { rows, totals: { gross: sum("gross"), basic: sum("basic"), gratuity: sum("gratuity"), monthlyAccrual: sum("monthlyAccrual") } };
}

/* ── e-invoice readiness (core fields only, not a full PINT AE validation) ── */

export const EINVOICE_FIELDS = [
  { key: "number", label: "Invoice number" },
  { key: "date", label: "Issue date" },
  { key: "trn", label: "Seller TRN" },
  { key: "buyerTrn", label: "Buyer TRN (B2B)" },
  { key: "customer", label: "Buyer name" },
  { key: "address", label: "Buyer address" },
  { key: "currency", label: "Currency code" },
  { key: "taxAmount", label: "VAT amount" },
  { key: "total", label: "Invoice total" },
] as const;
export function einvoiceReadiness(invoices: Invoice[], b2b: boolean) {
  const fields = EINVOICE_FIELDS.filter((f) => b2b || f.key !== "buyerTrn").map((f) => {
    const missing = invoices.filter((i) => {
      const v = i[f.key as keyof Invoice];
      if (f.key === "trn" || f.key === "buyerTrn") return !/^\d{15}$/.test(String(v ?? ""));
      return v == null || v === "";
    }).length;
    return { ...f, missing, ok: missing === 0 };
  });
  const cells = fields.length * Math.max(invoices.length, 1);
  const score = invoices.length ? Math.round(100 * (1 - fields.reduce((a, f) => a + f.missing, 0) / cells)) : 0;
  return { fields, score, invoices: invoices.length, ready: invoices.filter((i) => fields.every((f) => {
    const v = i[f.key as keyof Invoice];
    return f.key === "trn" || f.key === "buyerTrn" ? /^\d{15}$/.test(String(v ?? "")) : v != null && v !== "";
  })).length };
}

/* ── a visitor's own files → the same shapes ── */

export type Loaded = { kind: FileKind; name: string; rows: number; payouts?: PayoutLine[]; bank?: BankLine[]; invoices?: Invoice[]; chart?: Account[]; employees?: Employee[]; gatewayGuess?: string };

const GATEWAY_HINTS: [RegExp, string][] = [
  [/stripe/i, "Stripe"], [/shopify/i, "Shopify Payments"], [/tabby/i, "Tabby"], [/tamara/i, "Tamara"],
  [/telr/i, "Telr"], [/checkout/i, "Checkout.com"], [/network|ni_|mpgs/i, "Network International"], [/cod|aramex|courier/i, "COD courier"],
];

export function loadTable(name: string, t: Table, industry: Industry): Loaded {
  const kind = detectKind(t);
  const h = t.headers;
  const c = (k: keyof typeof ALIASES) => col(h, [...ALIASES[k]]);
  const get = (r: string[], i: number) => (i >= 0 ? r[i] : undefined);
  const gatewayGuess = GATEWAY_HINTS.find(([re]) => re.test(name) || re.test(h.join(" ")))?.[1] ?? "Gateway";
  if (kind === "payout") {
    const [di, ai, fi, vi, ni, ci, ri] = [c("date"), c("amount"), c("fee"), c("vat"), c("net"), c("currency"), c("ref")];
    const payouts: PayoutLine[] = t.rows.map((r, i) => {
      const gross = num(get(r, ai)); const fee = Math.abs(num(get(r, fi)) || 0); const vat = Math.abs(num(get(r, vi)) || 0);
      const net = Number.isNaN(num(get(r, ni))) ? r2(gross - fee - vat) : num(get(r, ni));
      const g = Number.isNaN(gross) ? r2(net + fee + vat) : gross;
      const d = day(get(r, di));
      return { payoutId: `${gatewayGuess.split(" ")[0].toUpperCase()}-${d.slice(0, 10) || "ROW" + i}`, gateway: gatewayGuess, date: d, ref: (get(r, ri) || `ROW${i + 1}`).slice(0, 60),
        currency: (get(r, ci) || "AED").toUpperCase().slice(0, 3), gross: g, fee, vat, net, kind: g < 0 ? "refund" : "sale" } satisfies PayoutLine;
    }).filter((p) => !Number.isNaN(p.gross));
    return { kind, name, rows: payouts.length, payouts, gatewayGuess };
  }
  if (kind === "bank") {
    const [di, dsi, ai, dri, cri] = [c("date"), c("description"), c("amount"), c("debit"), c("credit")];
    const bank = t.rows.map((r) => {
      const amount = ai >= 0 && !Number.isNaN(num(get(r, ai))) ? num(get(r, ai)) : (num(get(r, cri)) || 0) - Math.abs(num(get(r, dri)) || 0);
      return { date: day(get(r, di)), description: (get(r, dsi) || "").slice(0, 140), amount: r2(amount) };
    }).filter((b) => b.amount !== 0 && !Number.isNaN(b.amount));
    return { kind, name, rows: bank.length, bank };
  }
  if (kind === "invoices") {
    const [di, ai, ci, cui, ri] = [c("date"), c("amount"), c("currency"), c("customer"), col(h, ["invoice number", "invoice no", "invoice", "order number", "order", "number", "reference"])];
    const invoices = t.rows.map((r, i) => ({ number: (get(r, ri) || `INV${i + 1}`).slice(0, 60), date: day(get(r, di)), customer: (get(r, cui) || "").slice(0, 80), currency: (get(r, ci) || "AED").toUpperCase().slice(0, 3), total: num(get(r, ai)),
      trn: get(r, col(h, ["seller trn", "trn"])) || undefined, buyerTrn: get(r, col(h, ["buyer trn", "customer trn"])) || undefined,
      taxAmount: num(get(r, col(h, ["vat", "tax"]))) || undefined, address: get(r, col(h, ["address", "billing address"])) || undefined })).filter((x) => !Number.isNaN(x.total));
    return { kind, name, rows: invoices.length, invoices };
  }
  if (kind === "coa") {
    const [ci, ni, ti] = [c("code"), col(h, ["account name", "name", "account"]), c("accountType")];
    const chart: Account[] = t.rows.map((r) => ({ code: get(r, ci) || "", name: get(r, ni) || "", type: (["Asset", "Liability", "Equity", "Income", "Cost of sales", "Expense"].find((x) => (get(r, ti) || "").toLowerCase().startsWith(x.toLowerCase().slice(0, 4))) ?? "Expense") as Account["type"] })).filter((a) => a.name);
    return { kind, name, rows: chart.length, chart: chart.length ? chart : chartFor(industry) };
  }
  if (kind === "payroll") {
    const [ni, bi, ali, ji] = [c("employee"), c("basic"), c("allowances"), c("joined")];
    const employees = t.rows.map((r) => ({ name: (get(r, ni) || "").slice(0, 60), basic: num(get(r, bi)) || 0, allowances: num(get(r, ali)) || 0, joined: day(get(r, ji)) || "2024-01-01" })).filter((e) => e.basic > 0);
    return { kind, name, rows: employees.length, employees };
  }
  return { kind, name, rows: t.rows.length };
}
