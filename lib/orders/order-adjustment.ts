// Order adjustments — cancel, return, refund or exchange an order from the
// app, with its Zoho credit note (and an exchange's replacement invoice)
// planned here. Pure: hand it the Zoho invoice, it returns the documents to
// create and what the customer owes or is owed. No I/O.
//
// Founder rules (2026-10-02):
//   - Cancelled COD (invoice open, no cash): full credit note APPLIED to the
//     invoice, so both close at 0.
//   - Return with damage: credit note for (returned value − damage). Unpaid
//     invoice → the note is applied and the damage stays owed on the invoice.
//     Paid invoice → the note stays open as the refund due.
//   - Prepaid refund: the credit note is raised now and stays open; the
//     payout's refund line later refunds it (publish-refunds reuses an open
//     note of that amount), so nothing is credited twice.
//   - Exchange: credit note for the returned items, a new invoice to the SAME
//     Zoho customer for the replacement, the note applied to it. Only the
//     price difference is revenue (management_report_definitions).
//
// Money is VAT-inclusive (what the customer paid) everywhere in this module.
// Zoho line rates are built in the invoice's own tax basis.

/** Credit-note kinds: the planner below books these. "received" (close the
 *  invoice with a payment) is handled by runReceived in the service. */
export type CreditKind = "cancelled" | "returned" | "refunded" | "exchanged";
export type AdjustmentKind = CreditKind | "received";
export const ADJUSTMENT_KINDS: AdjustmentKind[] = ["cancelled", "returned", "refunded", "exchanged", "received"];

export const KIND_LABEL: Record<AdjustmentKind, string> = {
  received: "Received",
  cancelled: "Cancelled",
  returned: "Returned",
  refunded: "Refunded",
  exchanged: "Exchanged",
};

export type ZInvoiceLine = {
  line_item_id: string;
  item_id?: string;
  name: string;
  description?: string;
  quantity: number;
  rate: number;
  item_total: number;
  tax_id?: string;
  tax_percentage?: number;
  account_id?: string;
  warehouse_id?: string;
  location_id?: string;
  /** Batch-tracked items: the batches the invoice took stock out of. A
   *  credit note returning the item must name the batch it goes back into
   *  (Zoho code 2302 "The batch number cannot be left empty"). */
  batches?: { batch_id: string; batch_number: string; out_quantity: number }[];
  /** Kit (combo) items: the component lines Zoho moved stock for. A kit's
   *  own line has no batch — its batch-tracked components do, and a credit
   *  note returning the kit must name them (2302 on "LED Set Box", OS3781). */
  mapped_items?: KitComponent[];
};

export type KitComponent = {
  item_id: string;
  name: string;
  /** Units of this component on the invoice line (all kits together). */
  quantity: number;
  warehouse_id?: string;
  batches?: { batch_id: string; batch_number: string; out_quantity: number }[];
};

/** Spread a returned quantity over the batches the invoice took it from,
 *  in the invoice's order. */
export function returnBatches(line: Pick<ZInvoiceLine, "batches">, qty: number): { batch_id: string; batch_number: string; in_quantity: number }[] {
  const out: { batch_id: string; batch_number: string; in_quantity: number }[] = [];
  let left = qty;
  for (const b of line.batches ?? []) {
    if (left <= 0) break;
    const take = Math.min(left, Number(b.out_quantity) || 0);
    if (take > 0) { out.push({ batch_id: b.batch_id, batch_number: b.batch_number, in_quantity: take }); left -= take; }
  }
  // more back than the batches list shows: the rest goes to the first batch
  if (left > 0 && out.length) out[0].in_quantity += left;
  return out;
}

/** A kit coming back: each component in proportion, back into the batches
 *  the invoice took it from. */
export function returnKitComponents(line: ZInvoiceLine, qty: number) {
  const kits = Number(line.quantity) || 1;
  return (line.mapped_items ?? []).map((c) => {
    const q = r2((Number(c.quantity) || 0) / kits * qty);
    return {
      item_id: c.item_id,
      quantity: q,
      ...(c.warehouse_id ? { warehouse_id: c.warehouse_id } : {}),
      ...(c.batches?.length ? { batches: returnBatches(c, q) } : {}),
    };
  });
}

export type ZInvoice = {
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name?: string;
  date?: string;
  status: string;
  total: number;
  balance: number;
  is_inclusive_tax: boolean;
  tax_treatment?: string;
  place_of_supply?: string;
  currency_code?: string;
  line_items: ZInvoiceLine[];
};

export type ReturnPick = { line_item_id: string; qty: number };
/** A replacement item. `unitGross` is the customer's price per unit, VAT included. */
export type ExchangeItem = { item_id?: string; name: string; qty: number; unitGross: number };

export type AdjustmentInput = {
  kind: CreditKind;
  orderNumber: string;
  date: string; // YYYY-MM-DD
  /** Lines coming back. Ignored for cancelled (always the whole invoice);
   *  empty for returned/refunded/exchanged means the whole invoice. */
  picks?: ReturnPick[];
  /** Kept back from the credit: damage on a return/exchange, the part not
   *  refunded on a partial refund. Never applies to a cancellation. */
  deductAed?: number;
  exchange?: ExchangeItem[];
  note?: string;
};

export type PlannedLine = { name: string; qty: number; unitGross: number; grossAed: number };

export type AdjustmentPlan = {
  ok: boolean;
  error: string | null;
  invoice: { id: string; number: string; total: number; balance: number; status: string; paid: number };
  returned: PlannedLine[];
  returnedGrossAed: number;
  deductAed: number;
  creditAed: number;
  fullCredit: boolean;
  exchange: PlannedLine[];
  exchangeTotalAed: number;
  /** Credit applied to the replacement invoice, then to the original's balance. */
  applyToExchangeAed: number;
  applyToInvoiceAed: number;
  /** Left open on the credit note: refund (or store credit) due to the customer. */
  refundDueAed: number;
  /** Still to collect: original balance not covered + replacement not covered. */
  customerOwesAed: number;
  references: { creditNote: string; exchangeInvoice: string };
  creditNoteBody: Record<string, unknown> | null;
  exchangeInvoiceBody: Record<string, unknown> | null;
  /** Plain sentences for the dialog's preview. */
  steps: string[];
};

/** Below this a rounding residual is not sent as a Zoho "adjustment" (rejected when VAT-registered). */
const ADJUSTMENT_MIN_AED = 0.05;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const aed = (n: number) => `AED ${r2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One unit of an invoice line as the customer paid it (VAT in, line discount out). */
export function unitGross(inv: Pick<ZInvoice, "is_inclusive_tax">, l: ZInvoiceLine): number {
  const q = Number(l.quantity) || 0;
  if (q <= 0) return 0;
  const unitNet = Number(l.item_total) / q;
  return inv.is_inclusive_tax ? unitNet : unitNet * (1 + (Number(l.tax_percentage) || 0) / 100);
}

/** Header-level money (shipping charge, entity discount, adjustment) spread
 *  over the lines, so returning every line credits exactly the invoice total. */
function headerRatio(inv: ZInvoice): number {
  const linesGross = inv.line_items.reduce((s, l) => s + unitGross(inv, l) * (Number(l.quantity) || 0), 0);
  return linesGross > 0 ? Number(inv.total) / linesGross : 1;
}

export function adjustmentReferences(orderNumber: string) {
  return { creditNote: `ADJ/${orderNumber}/CN`, exchangeInvoice: `ADJ/${orderNumber}/EXI` };
}

/** Zoho's total for lines built at these rates (tax per line, VAT-inclusive). */
function zohoTotal(inclusive: boolean, lines: { quantity: number; rate: number; tax_percentage?: number }[]): number {
  return r2(lines.reduce((s, l) => s + l.quantity * l.rate * (inclusive ? 1 : 1 + (l.tax_percentage ?? 0) / 100), 0));
}

export function planAdjustment(inv: ZInvoice, input: AdjustmentInput): AdjustmentPlan {
  const refs = adjustmentReferences(input.orderNumber);
  const total = r2(Number(inv.total) || 0);
  const balance = r2(Number(inv.balance) || 0);
  const base: AdjustmentPlan = {
    ok: false, error: null,
    invoice: { id: inv.invoice_id, number: inv.invoice_number, total, balance, status: inv.status, paid: r2(total - balance) },
    returned: [], returnedGrossAed: 0, deductAed: 0, creditAed: 0, fullCredit: false,
    exchange: [], exchangeTotalAed: 0, applyToExchangeAed: 0, applyToInvoiceAed: 0,
    refundDueAed: 0, customerOwesAed: 0, references: refs, creditNoteBody: null, exchangeInvoiceBody: null, steps: [],
  };
  const fail = (error: string): AdjustmentPlan => ({ ...base, error });

  if (String(inv.status).toLowerCase() === "void") return fail(`Invoice ${inv.invoice_number} is void in Zoho — nothing to credit.`);
  if (!inv.line_items.length) return fail(`Invoice ${inv.invoice_number} has no lines.`);

  // what comes back
  const byId = new Map(inv.line_items.map((l) => [l.line_item_id, l]));
  const wholeInvoice = input.kind === "cancelled" || !input.picks || input.picks.length === 0;
  const picks: ReturnPick[] = wholeInvoice
    ? inv.line_items.map((l) => ({ line_item_id: l.line_item_id, qty: Number(l.quantity) || 0 }))
    : input.picks!.filter((p) => p.qty > 0);
  for (const p of picks) {
    const l = byId.get(p.line_item_id);
    if (!l) return fail(`Line ${p.line_item_id} is not on invoice ${inv.invoice_number}.`);
    if (p.qty > (Number(l.quantity) || 0)) return fail(`Only ${l.quantity} × ${l.name} on the invoice — cannot return ${p.qty}.`);
  }
  if (!picks.length) return fail("Pick at least one line coming back.");

  const ratio = headerRatio(inv);
  const returned = picks.map((p) => {
    const l = byId.get(p.line_item_id)!;
    const ug = unitGross(inv, l) * ratio;
    return { line: l, qty: p.qty, unitGross: ug, gross: ug * p.qty };
  });
  const returnedGross = r2(wholeInvoice ? total : returned.reduce((s, x) => s + x.gross, 0));
  const deduct = input.kind === "cancelled" ? 0 : r2(Math.min(Math.max(Number(input.deductAed) || 0, 0), returnedGross));
  const credit = r2(returnedGross - deduct);
  if (credit <= 0) return fail("The credit comes to zero — nothing to book. Lower the damage / kept amount.");

  // credit note lines: the returned lines at their rates, scaled so the note
  // totals exactly the credit (header money spread in, damage taken out)
  const linesGross = returned.reduce((s, x) => s + (x.gross / ratio), 0);
  const factor = linesGross > 0 ? credit / linesGross : 0;
  const cnLines = returned.map(({ line, qty }) => ({
    ...(line.item_id ? { item_id: line.item_id } : {}),
    name: line.name,
    description: line.description || "",
    quantity: qty,
    rate: r2((Number(line.item_total) / (Number(line.quantity) || 1)) * factor),
    ...(line.tax_id ? { tax_id: line.tax_id } : {}),
    tax_percentage: Number(line.tax_percentage) || 0,
    ...(line.account_id ? { account_id: line.account_id } : {}),
    ...(line.warehouse_id ? { warehouse_id: line.warehouse_id } : {}),
    ...(line.location_id ? { location_id: line.location_id } : {}),
    ...(line.batches?.length ? { batches: returnBatches(line, qty) } : {}),
    ...(line.mapped_items?.length ? { mapped_items: returnKitComponents(line, qty) } : {}),
  }));
  const cnResidual = r2(credit - zohoTotal(inv.is_inclusive_tax, cnLines));

  // exchange invoice
  const exchangeItems = input.kind === "exchanged" ? (input.exchange ?? []).filter((e) => e.qty > 0 && e.unitGross > 0) : [];
  if (input.kind === "exchanged" && !exchangeItems.length) return fail("Add the replacement item(s) the customer is getting.");
  const taxLine = inv.line_items.find((l) => l.tax_id && (Number(l.tax_percentage) || 0) > 0) ?? inv.line_items.find((l) => l.tax_id) ?? inv.line_items[0];
  const exTax = Number(taxLine.tax_percentage) || 0;
  const exLines = exchangeItems.map((e) => ({
    ...(e.item_id ? { item_id: e.item_id } : {}),
    name: e.name,
    quantity: e.qty,
    rate: r2(inv.is_inclusive_tax ? e.unitGross : e.unitGross / (1 + exTax / 100)),
    ...(taxLine.tax_id ? { tax_id: taxLine.tax_id } : {}),
    tax_percentage: exTax,
    ...(taxLine.account_id ? { account_id: taxLine.account_id } : {}),
  }));
  const exchangeTotal = r2(exchangeItems.reduce((s, e) => s + e.qty * e.unitGross, 0));
  const exResidual = r2(exchangeTotal - zohoTotal(inv.is_inclusive_tax, exLines));

  // where the credit goes
  const applyToExchange = r2(Math.min(credit, exchangeTotal));
  const applyToInvoice = r2(Math.min(credit - applyToExchange, balance));
  const refundDue = r2(credit - applyToExchange - applyToInvoice);
  const customerOwes = r2(exchangeTotal - applyToExchange + balance - applyToInvoice);

  const strip = <T extends { tax_percentage?: number }>(l: T) => { const { tax_percentage: _t, ...rest } = l; return rest; };
  const why = input.note?.trim() ? ` ${input.note.trim()}` : "";
  const creditNoteBody: Record<string, unknown> = {
    customer_id: inv.customer_id,
    date: input.date,
    reference_number: refs.creditNote,
    invoice_id: inv.invoice_id,
    is_inclusive_tax: inv.is_inclusive_tax,
    ...(inv.tax_treatment ? { tax_treatment: inv.tax_treatment } : {}),
    ...(inv.place_of_supply ? { place_of_supply: inv.place_of_supply } : {}),
    notes: `${KIND_LABEL[input.kind]} — order ${input.orderNumber} (invoice ${inv.invoice_number}).` +
      (deduct > 0 ? ` ${input.kind === "refunded" ? "Not refunded" : "Damage charged"}: ${aed(deduct)}.` : "") + why,
    line_items: cnLines.map(strip),
    // Zoho refuses a header adjustment in a VAT-registered org (code 73006),
    // so a few cents of line rounding are left to Zoho's own math.
    ...(Math.abs(cnResidual) >= ADJUSTMENT_MIN_AED ? { adjustment: cnResidual, adjustment_description: "Rounding" } : {}),
  };
  const exchangeInvoiceBody: Record<string, unknown> | null = exLines.length
    ? {
        customer_id: inv.customer_id,
        date: input.date,
        reference_number: refs.exchangeInvoice,
        is_inclusive_tax: inv.is_inclusive_tax,
        ...(inv.tax_treatment ? { tax_treatment: inv.tax_treatment } : {}),
        ...(inv.place_of_supply ? { place_of_supply: inv.place_of_supply } : {}),
        notes: `Exchange for order ${input.orderNumber} (returned against ${inv.invoice_number}).${why}`,
        line_items: exLines.map(strip),
        ...(Math.abs(exResidual) >= ADJUSTMENT_MIN_AED ? { adjustment: exResidual, adjustment_description: "Rounding" } : {}),
      }
    : null;

  const steps: string[] = [];
  steps.push(`Credit note ${refs.creditNote} for ${aed(credit)} against ${inv.invoice_number}` +
    (deduct > 0 ? ` (${aed(returnedGross)} returned − ${aed(deduct)} ${input.kind === "refunded" ? "kept" : "damage"})` : "") + ".");
  if (exchangeInvoiceBody) steps.push(`New invoice ${refs.exchangeInvoice} to the same customer for ${aed(exchangeTotal)}, with ${aed(applyToExchange)} of the credit applied.`);
  if (applyToInvoice > 0) steps.push(`${aed(applyToInvoice)} of the credit applied to ${inv.invoice_number} (it had ${aed(balance)} unpaid).`);
  if (refundDue > 0) steps.push(input.kind === "cancelled" || input.kind === "refunded"
    ? `${aed(refundDue)} stays open on the credit note — the gateway refund in a later payout closes it (or refund it in Zoho for cash/COD).`
    : `${aed(refundDue)} stays open on the credit note — refund it to the customer or keep it as store credit.`);
  if (customerOwes > 0) steps.push(`Customer still owes ${aed(customerOwes)}.`);

  return {
    ...base,
    ok: true,
    returned: returned.map((x) => ({ name: x.line.name, qty: x.qty, unitGross: r2(x.unitGross), grossAed: r2(x.gross) })),
    returnedGrossAed: returnedGross,
    deductAed: deduct,
    creditAed: credit,
    fullCredit: credit >= total - 1,
    exchange: exchangeItems.map((e) => ({ name: e.name, qty: e.qty, unitGross: r2(e.unitGross), grossAed: r2(e.qty * e.unitGross) })),
    exchangeTotalAed: exchangeTotal,
    applyToExchangeAed: applyToExchange,
    applyToInvoiceAed: applyToInvoice,
    refundDueAed: refundDue,
    customerOwesAed: customerOwes,
    creditNoteBody,
    exchangeInvoiceBody,
    steps,
  };
}

/** What a posted adjustment means for the order everywhere sales are counted. */
export type OrderOps = { ops_status?: string | null; ops_credit_aed?: number | null };
export const isOpsCancelled = (o: OrderOps) => (o.ops_status || "").toLowerCase() === "cancelled";

/** Founder rule (2026-10-02, management_report_definitions #4): a COD order
 *  that comes back before the courier paid us out was never a sale — it is a
 *  cancellation, whatever button was pressed. Only a COD order whose cash was
 *  remitted (payout / voucher) and then given back is a real return / refund.
 *  Partial returns (something kept or charged) stay returns. */
export function codReturnIsCancellation(o: { kind: AdjustmentKind; gateway: string; payoutId: string | null; fullCredit: boolean }): boolean {
  return (o.kind === "returned" || o.kind === "refunded")
    && (o.gateway || "").trim().toUpperCase() === "COD"
    && !o.payoutId
    && o.fullCredit;
}

/** Reference of the payment that closes an invoice by hand. */
export const receivedReference = (orderNumber: string) => `MAN/${orderNumber}/PAY`;
