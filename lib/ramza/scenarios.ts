/* Synthetic reconciliation scenarios for the hero animation. No real data.
   Every scenario foots exactly — the arithmetic is stated in a comment so it
   can be checked at a glance. The bank account is AED throughout. */

export type ScenarioOrder = { ref: string; amount: number };

export type Scenario = {
  id: string;
  gateway: string;
  currency: "AED" | "SAR";
  /** gross value of the covered orders, in the gateway's currency */
  gross: number;
  fee: number;
  vatOnFee: number;
  /** SAR scenarios settle to AED at a wire rate */
  fx?: { rate: number; grossCurrency: "SAR"; note: string };
  /** refunds / undelivered orders carried out of this payout */
  heldBack?: { label: string; amount: number };
  /** what actually lands in the AED bank account */
  bankCredit: number;
  orders: ScenarioOrder[];
  moreCount: number;
  invoicesClosed: number;
  ariaLabel: string;
};

export const SCENARIOS: Scenario[] = [
  {
    // arithmetic (AED): 19,033.70 gross − 584.00 fee − 29.20 VAT = 18,420.50 bank
    id: "tabby",
    gateway: "Tabby",
    currency: "AED",
    gross: 19033.7,
    fee: 584.0,
    vatOnFee: 29.2,
    bankCredit: 18420.5,
    orders: [
      { ref: "AE-8801", amount: 412.0 },
      { ref: "AE-8802", amount: 268.5 },
      { ref: "AE-8803", amount: 1150.0 },
      { ref: "AE-8804", amount: 96.75 },
      { ref: "AE-8805", amount: 530.2 },
    ],
    moreCount: 37,
    invoicesClosed: 42,
    ariaLabel:
      "A Tabby payout covering 42 orders, gross 19,033.70 dirhams, matched to a bank credit of 18,420.50 dirhams after 584.00 in fees and 29.20 in VAT. 42 Zoho invoices flip to paid.",
  },
  {
    // arithmetic (SAR): 23,200.00 gross − 550.00 fee − 27.50 VAT = 22,622.50 net
    // FX to AED: 22,622.50 × 0.97930 = 22,154.21 bank credit
    id: "tamara",
    gateway: "Tamara",
    currency: "SAR",
    gross: 23200.0,
    fee: 550.0,
    vatOnFee: 27.5,
    fx: {
      rate: 0.9793,
      grossCurrency: "SAR",
      note: "SAR 22,622.50 settled to AED at 0.97930",
    },
    bankCredit: 22154.21,
    orders: [
      { ref: "SA-5512", amount: 780.0 },
      { ref: "SA-5513", amount: 1240.0 },
      { ref: "SA-5514", amount: 349.0 },
      { ref: "SA-5515", amount: 615.5 },
      { ref: "SA-5516", amount: 208.0 },
    ],
    moreCount: 33,
    invoicesClosed: 38,
    ariaLabel:
      "A Tamara payout in Saudi riyals covering 38 orders, gross 23,200.00 riyals, less 550.00 fee and 27.50 VAT, settled to a bank credit of 22,154.21 dirhams at a wire rate of 0.97930. 38 Zoho invoices flip to paid.",
  },
  {
    // arithmetic (AED): 31,500.00 collected − 360.00 COD fee − 18.00 VAT
    //                   − 1,240.00 undelivered = 29,882.00 remitted
    id: "cod",
    gateway: "COD courier",
    currency: "AED",
    gross: 31500.0,
    fee: 360.0,
    vatOnFee: 18.0,
    heldBack: { label: "4 undelivered orders", amount: 1240.0 },
    bankCredit: 29882.0,
    orders: [
      { ref: "AE-9001", amount: 725.0 },
      { ref: "AE-9002", amount: 189.0 },
      { ref: "AE-9003", amount: 1490.0 },
      { ref: "AE-9004", amount: 260.0 },
      { ref: "AE-9005", amount: 540.0 },
    ],
    moreCount: 51,
    invoicesClosed: 56,
    ariaLabel:
      "A cash-on-delivery courier remittance: 31,500.00 dirhams collected across 60 orders, less 360.00 handling fee, 18.00 VAT and 1,240.00 for four undelivered orders, matched to a bank credit of 29,882.00 dirhams. 56 Zoho invoices flip to paid.",
  },
];

export function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
