/* The one place RAMZA code reads dates, penalties and prices from.
 *
 * config/rules.json is owned by the compliance-gate agent (.claude/agents/)
 * and carries a source + verified_on for each regulatory value. Changing a
 * penalty, a deadline or a price is a one-file edit there — nothing in
 * lib/ramza or app/ramza may hardcode those numbers. */

import raw from "@/config/rules.json";

export type RamzaMode = "deadline" | "rescue" | "evergreen";

type Tier = { max_txn: number; aed_month: number | null };

export const rules = raw as typeof raw & {
  pricing: typeof raw.pricing & {
    tiers: Tier[];
    one_off: { late_filing_rescue_aed: number | null; backlog_discount_pct: number | null };
  };
};

export const CT = {
  filingMonths: rules.ct.filing_months_after_period_end,
  lateFilingFirst12Aed: rules.ct.late_filing_penalty.months_1_12_aed,
  lateFilingAfter12Aed: rules.ct.late_filing_penalty.month_13_plus_aed,
  latePaymentRatePa: rules.ct.late_payment.rate_pa,
  lateRegistrationAed: rules.ct.late_registration_aed,
  waiverMonths: rules.ct.late_registration_waiver.months_after_first_period_end,
  reconsiderationBusinessDays: rules.ct.reconsideration_business_days,
} as const;

/** Which message the campaign runs on a given Dubai day (YYYY-MM-DD). */
export function rulesMode(dubaiDay: string): RamzaMode {
  if (dubaiDay <= rules.campaign.deadline_mode_until) return "deadline";
  if (dubaiDay <= rules.campaign.rescue_mode_until) return "rescue";
  return "evergreen";
}

/** Monthly price for a billable transaction count, or null when the tier has
 *  no price yet (pricing is still a founder decision) or the count is above
 *  the largest tier — the UI must then show "Get a quote", never a guess. */
export function priceForTxn(txn: number): number | null {
  const tier = rules.pricing.tiers.find((t) => txn <= t.max_txn);
  return tier?.aed_month ?? null;
}

/** Billable transactions: bank lines + gateway lines at N-to-1. */
export function billableTxn(bankLines: number, gatewayLines: number): number {
  const b = Math.max(Math.round(bankLines) || 0, 0);
  const g = Math.max(Math.round(gatewayLines) || 0, 0);
  return b + Math.ceil(g / rules.pricing.gateway_lines_per_txn);
}

/** Who files on EmaraTax — RAMZA is not a tax agent; every filing line on the
 *  site must name this partner. */
export const FILING_PARTNER = rules.partner.filing_partner;

/** One-off late-filing rescue fee (AED), or null if not set. */
export const RESCUE_FEE_AED: number | null = rules.pricing.one_off.late_filing_rescue_aed ?? null;

export const VAT_RATE = rules.vat.standard_rate;

/** Corporate Tax on taxable income: 0% up to the threshold, the rate above. */
export function ctOn(taxableIncome: number): number {
  const over = Math.max(taxableIncome - rules.ct.rate.zero_rate_up_to_aed, 0);
  return Math.round(over * rules.ct.rate.rate_above);
}

/** E-invoicing dates + penalties (Cabinet Decision 106/2025). */
export const EINV = {
  largeRevenueAed: rules.einvoicing.large.revenue_gte_aed,
  largeAspBy: rules.einvoicing.large.asp_by,
  largeGoLive: rules.einvoicing.large.go_live,
  smeAspBy: rules.einvoicing.sme.asp_by,
  smeGoLive: rules.einvoicing.sme.go_live,
  aspLateAedPerMonth: rules.einvoicing.penalties.asp_late_aed_per_month,
  perInvoiceAed: rules.einvoicing.penalties.invoice_not_issued_aed,
  invoiceCapAedPerMonth: rules.einvoicing.penalties.invoice_cap_aed_per_month,
  legalBasis: rules.einvoicing.penalties.legal_basis,
} as const;
