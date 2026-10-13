// I/O side of order adjustments: find the order's invoice in whichever Zoho
// organisation holds it (COD lives in House of Omnia), plan the documents
// (lib/orders/order-adjustment.ts), and post them only on an explicit click.
//
// Idempotent like the settlement engine: every Zoho write is preceded by a
// PENDING:<uuid> marker on the row; a rerun that finds a marker looks the
// document up by its reference (ADJ/<order>/CN, ADJ/<order>/EXI) before
// creating anything, so a write Zoho accepted but never answered is relinked,
// not duplicated.

import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { OrderAdjustmentsRepository, type OrderAdjustmentRow } from "@/lib/repositories/order-adjustments.repository";
import { ZohoInvoiceIndexRepository } from "@/lib/repositories/zoho-invoice-index";
import { listZohoConnections, withZohoOrg, getScopedAccessToken } from "@/lib/integrations/zoho-org";
import { zohoOrgId } from "@/lib/integrations/zoho-context";
import { findZohoInvoiceCandidates } from "@/lib/integrations/zoho";
import {
  applyCreditNoteToInvoices,
  createCreditNote,
  createInvoice,
  withOutBatches,
  getCreditNoteLive,
  getInvoiceTaxProfile,
  getInvoiceMoneySummary,
  listCustomerCreditNotes,
  listCustomerInvoices,
  searchItems,
  fetchPostingOptions,
  findOurPaymentOnInvoice,
  createCustomerPayment,
  customerPaymentExists,
} from "@/lib/integrations/zoho-settlement-posting";
import { buildCustomerPaymentBody } from "@/lib/integrations/zoho";
import { suggestPostingAccounts } from "@/lib/finance/settlement-posting";
import { dubaiToday } from "@/lib/dubai-day";
import { codReturnIsCancellation, planAdjustment, receivedReference, type AdjustmentInput, type AdjustmentKind, type AdjustmentPlan, type CreditKind, type ZInvoice } from "./order-adjustment";

const isReal = (id: string | null | undefined): boolean => !!id && !id.startsWith("PENDING:");
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type InvoiceCandidate = {
  connectionId: string; org: string; orgId: string; invoiceId: string; number: string; customer: string;
  date: string; status: string; total: number; balance: number; reference: string;
};

type OrderLite = { uid: string; order_number: string; store_id: string; gateway: string; gross_aed: number; customer_name: string; financial_status: string; order_date: string | null; payout_id?: string | null };

async function loadOrder(uid: string): Promise<OrderLite> {
  const o = (await OrdersRepository.getByUid(uid)) as unknown as OrderLite | null;
  if (!o) throw new Error("Order not found");
  return o;
}

/** Every non-void invoice for the order number in every active Zoho org —
 *  House of Omnia first for COD (that is where COD is booked). Our own
 *  exchange invoices (reference ADJ/…) are left out: they are not the sale. */
export async function findOrderInvoices(order: Pick<OrderLite, "order_number" | "gateway">): Promise<{ candidates: InvoiceCandidate[]; errors: string[] }> {
  const conns = (await listZohoConnections()).filter((c) => c.status !== "disabled");
  const cod = (order.gateway || "").toUpperCase() === "COD";
  conns.sort((a, b) => {
    const score = (c: typeof a) => (cod ? (c.defaultForProviders.includes("COD") ? 0 : 1) : c.source === "env" ? 0 : 1);
    return score(a) - score(b);
  });
  const candidates: InvoiceCandidate[] = [];
  const errors: string[] = [];
  for (const c of conns) {
    try {
      await withZohoOrg(c.id, async () => {
        const token = await getScopedAccessToken();
        const rows = await findZohoInvoiceCandidates(order.order_number, token, zohoOrgId());
        for (const r of rows) {
          if (String(r.status).toLowerCase() === "void") continue;
          if (String(r.reference_number ?? "").startsWith("ADJ/")) continue;
          candidates.push({
            connectionId: c.id, org: c.label, orgId: c.orgId, invoiceId: r.invoice_id, number: r.invoice_number, customer: r.customer_name,
            date: r.date, status: String(r.status), total: Number(r.total), balance: Number(r.balance), reference: r.reference_number ?? "",
          });
        }
      });
    } catch (e) {
      errors.push(`${c.label}: ${(e as Error).message}`);
    }
  }
  return { candidates, errors };
}

const outBatches = (v: unknown) => Array.isArray(v) && v.length
  ? (v as Record<string, unknown>[]).map((b) => ({ batch_id: String(b.batch_id), batch_number: String(b.batch_number ?? ""), out_quantity: Number(b.out_quantity ?? 0) }))
  : undefined;

/** The invoice as Zoho holds it, shaped for the planner. */
export async function loadInvoice(connectionId: string, invoiceId: string): Promise<ZInvoice> {
  return withZohoOrg(connectionId, async () => {
    const token = await getScopedAccessToken();
    const inv = (await getInvoiceTaxProfile(invoiceId, token)) as unknown as Record<string, unknown> & { line_items: Record<string, unknown>[] };
    return {
      invoice_id: String(inv.invoice_id), invoice_number: String(inv.invoice_number), customer_id: String(inv.customer_id),
      customer_name: String(inv.customer_name ?? ""), date: String(inv.date ?? ""), status: String(inv.status ?? ""),
      total: Number(inv.total ?? 0), balance: Number(inv.balance ?? 0), is_inclusive_tax: Boolean(inv.is_inclusive_tax),
      tax_treatment: (inv.tax_treatment as string) || undefined, place_of_supply: (inv.place_of_supply as string) || undefined,
      currency_code: String(inv.currency_code ?? "AED"),
      line_items: (inv.line_items ?? []).map((l) => ({
        line_item_id: String(l.line_item_id), item_id: l.item_id ? String(l.item_id) : undefined, name: String(l.name ?? ""),
        description: String(l.description ?? ""), quantity: Number(l.quantity ?? 0), rate: Number(l.rate ?? 0), item_total: Number(l.item_total ?? 0),
        tax_id: l.tax_id ? String(l.tax_id) : undefined, tax_percentage: Number(l.tax_percentage ?? 0),
        account_id: l.account_id ? String(l.account_id) : undefined, warehouse_id: l.warehouse_id ? String(l.warehouse_id) : undefined,
        location_id: l.location_id ? String(l.location_id) : undefined,
        batches: outBatches(l.batches),
        mapped_items: Array.isArray(l.mapped_items) && l.mapped_items.length
          ? (l.mapped_items as Record<string, unknown>[]).map((m) => ({
              item_id: String(m.item_id), name: String(m.name ?? ""), quantity: Number(m.quantity ?? 0),
              warehouse_id: m.warehouse_id ? String(m.warehouse_id) : undefined, batches: outBatches(m.batches),
            }))
          : undefined,
      })),
    };
  });
}

export async function getAdjustmentContext(uid: string, pick?: { connectionId?: string | null; invoiceId?: string | null }) {
  const order = await loadOrder(uid);
  const adjustments = await OrderAdjustmentsRepository.forOrder(uid);
  const { candidates, errors } = await findOrderInvoices(order);
  const chosen = (pick?.invoiceId && candidates.find((c) => c.invoiceId === pick.invoiceId))
    // one open-or-paid invoice, or the one whose total is the order's
    || (candidates.length === 1 ? candidates[0] : candidates.find((c) => Math.abs(c.total - Number(order.gross_aed)) < 1))
    || null;
  const invoice = chosen ? await loadInvoice(chosen.connectionId, chosen.invoiceId) : null;
  return { order, adjustments, candidates, errors, chosen, invoice };
}

export async function searchZohoItems(connectionId: string, q: string) {
  return withZohoOrg(connectionId, async () => searchItems(q, await getScopedAccessToken()));
}

export type RunInput = {
  uid: string;
  connectionId: string | null;
  invoiceId: string | null;
  kind: AdjustmentKind;
  date?: string;
  picks?: AdjustmentInput["picks"];
  deductAed?: number;
  exchange?: AdjustmentInput["exchange"];
  note?: string;
  /** Record the outcome without writing to Zoho (documents booked by hand, or no invoice). */
  markOnly?: boolean;
  /** kind "received": what came in, through which gateway, into which Zoho account. */
  receivedAed?: number;
  receivedVia?: string;
  depositAccountId?: string;
  depositAccountName?: string;
  dryRun: boolean;
  actor: string;
};

export type RunResult = {
  ok: boolean;
  dryRun: boolean;
  plan: AdjustmentPlan | null;
  adjustment: OrderAdjustmentRow | null;
  documents: { creditNote: string | null; exchangeInvoice: string | null };
  readBack: { creditNoteBalance: number | null; invoiceBalance: number | null; exchangeBalance: number | null } | null;
  message: string;
};

export async function runAdjustment(inputIn: RunInput): Promise<RunResult> {
  let input = inputIn;
  const order = await loadOrder(input.uid);
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : dubaiToday();
  const existing = (await OrderAdjustmentsRepository.forOrder(input.uid));
  // A "received" close doesn't block a later refund / return / cancellation:
  // money came in, then (part of) it went back. Anything else must be undone first.
  const posted = existing.find((a) => a.status === "posted" && !(a.kind === "received" && input.kind !== "received"));
  if (posted) {
    return {
      ok: false, dryRun: input.dryRun, plan: null, adjustment: posted, documents: { creditNote: posted.zoho_creditnote_number || null, exchangeInvoice: posted.zoho_exchange_invoice_number || null }, readBack: null,
      message: `Order ${order.order_number} is already marked ${posted.kind}${posted.zoho_creditnote_number ? ` (credit note ${posted.zoho_creditnote_number})` : ""}. Undo that first.`,
    };
  }

  if (input.kind === "received" && !input.markOnly) return runReceived(input, order, date);

  // COD back before the courier paid us → a cancellation (codReturnIsCancellation)
  if (input.kind !== "received" && codReturnIsCancellation({
    kind: input.kind, gateway: order.gateway, payoutId: order.payout_id ?? null,
    fullCredit: !(Number(input.deductAed) > 0) && !(input.picks?.length),
  })) {
    input = { ...input, kind: "cancelled", deductAed: 0, note: `${input.note ? `${input.note} · ` : ""}COD returned before the courier paid out — recorded as cancelled` };
  }

  // mark only — no Zoho
  if (input.markOnly) {
    if (input.dryRun) {
      return { ok: true, dryRun: true, plan: null, adjustment: null, documents: { creditNote: null, exchangeInvoice: null }, readBack: null,
        message: `Will mark ${order.order_number} as ${input.kind} without writing to Zoho.` };
    }
    const credit = input.kind === "received" ? 0 : input.kind === "cancelled" ? Number(order.gross_aed) : r2(Number(order.gross_aed) - (Number(input.deductAed) || 0));
    const row = await OrderAdjustmentsRepository.insert({
      order_uid: order.uid, order_number: order.order_number, store_id: order.store_id, kind: input.kind, adjustment_date: date,
      zoho_connection_id: input.connectionId || "env", credit_aed: credit, damage_aed: input.kind === "received" ? 0 : Number(input.deductAed) || 0, mark_only: true,
      ...(input.kind === "received" ? { received_aed: Number(input.receivedAed) || Number(order.gross_aed), received_via: input.receivedVia || order.gateway } : {}),
      note: input.note ?? "", status: "posted", created_by: input.actor, posted_at: new Date().toISOString(),
    });
    await OrderAdjustmentsRepository.setOrderOps(order.uid, { kind: input.kind, creditAed: credit });
    return { ok: true, dryRun: false, plan: null, adjustment: row, documents: { creditNote: null, exchangeInvoice: null }, readBack: null,
      message: `${order.order_number} marked ${input.kind} (no Zoho documents written).` };
  }

  if (!input.connectionId || !input.invoiceId) {
    return { ok: false, dryRun: input.dryRun, plan: null, adjustment: null, documents: { creditNote: null, exchangeInvoice: null }, readBack: null,
      message: "No Zoho invoice chosen for this order. Pick one, or use “Mark only” if it isn't in Zoho." };
  }
  const connectionId = input.connectionId;
  const invoice = await loadInvoice(connectionId, input.invoiceId);
  const plan = planAdjustment(invoice, {
    kind: input.kind as CreditKind, orderNumber: order.order_number, date, picks: input.picks, deductAed: input.deductAed, exchange: input.exchange, note: input.note,
  });
  if (!plan.ok || input.dryRun) {
    return { ok: plan.ok, dryRun: input.dryRun, plan, adjustment: null, documents: { creditNote: null, exchangeInvoice: null }, readBack: null,
      message: plan.ok ? "Preview only — nothing written." : plan.error! };
  }

  // resume a draft/error row for this order rather than starting a second one
  // One unfinished attempt per order: reuse it (its PENDING markers are how
  // a rerun finds documents Zoho created without answering), refreshed to
  // the choice made now. Extra stale attempts are dropped.
  const unfinished = existing.filter((a) => a.status !== "posted");
  const prior = unfinished.find((a) => a.zoho_invoice_id === invoice.invoice_id && isReal(a.zoho_creditnote_id))
    ?? unfinished.find((a) => a.zoho_invoice_id === invoice.invoice_id) ?? null;
  for (const a of unfinished) if (a !== prior && !isReal(a.zoho_creditnote_id) && !isReal(a.zoho_exchange_invoice_id)) await OrderAdjustmentsRepository.remove(a.id);
  if (prior && !isReal(prior.zoho_creditnote_id)) {
    await OrderAdjustmentsRepository.update(prior.id, {
      kind: input.kind, adjustment_date: date, returned_lines: plan.returned, damage_aed: plan.deductAed, credit_aed: plan.creditAed,
      exchange_lines: plan.exchange, exchange_total: plan.exchangeTotalAed, customer_owes_aed: plan.customerOwesAed,
      refund_due_aed: plan.refundDueAed, note: input.note ?? "", created_by: input.actor,
    });
  }
  let row = (prior ? { ...prior, kind: input.kind, credit_aed: plan.creditAed } : null)
    ?? await OrderAdjustmentsRepository.insert({
      order_uid: order.uid, order_number: order.order_number, store_id: order.store_id, kind: input.kind, adjustment_date: date,
      zoho_connection_id: connectionId, zoho_invoice_id: invoice.invoice_id, zoho_invoice_number: invoice.invoice_number,
      invoice_total: plan.invoice.total, returned_lines: plan.returned, damage_aed: plan.deductAed, credit_aed: plan.creditAed,
      exchange_lines: plan.exchange, exchange_total: plan.exchangeTotalAed, customer_owes_aed: plan.customerOwesAed,
      refund_due_aed: plan.refundDueAed, note: input.note ?? "", status: "draft", created_by: input.actor,
    });
  const save = async (patch: Partial<OrderAdjustmentRow>) => { await OrderAdjustmentsRepository.update(row.id, patch); row = { ...row, ...patch }; };

  try {
    return await withZohoOrg(connectionId, async () => {
      const token = await getScopedAccessToken();

      // 1. credit note
      if (!isReal(row.zoho_creditnote_id)) {
        let found: { id: string; number: string } | null = null;
        if (row.zoho_creditnote_id?.startsWith("PENDING:")) {
          const n = (await listCustomerCreditNotes(invoice.customer_id, token)).find((c) => String(c.reference_number ?? "").trim() === plan.references.creditNote && c.status !== "void");
          if (n) found = { id: n.creditnote_id, number: n.creditnote_number };
        }
        if (!found) {
          await save({ zoho_creditnote_id: `PENDING:${crypto.randomUUID()}`, error: null });
          found = await createCreditNote(plan.creditNoteBody, token);
        }
        await save({ zoho_creditnote_id: found.id, zoho_creditnote_number: found.number });
      }

      // 2. replacement invoice (exchange)
      if (plan.exchangeInvoiceBody && !isReal(row.zoho_exchange_invoice_id)) {
        let found: { id: string; number: string } | null = null;
        if (row.zoho_exchange_invoice_id?.startsWith("PENDING:")) {
          const i = (await listCustomerInvoices(invoice.customer_id, token)).find((x) => String(x.reference_number ?? "").trim() === plan.references.exchangeInvoice && x.status !== "void");
          if (i) found = { id: i.invoice_id, number: i.invoice_number };
        }
        if (!found) {
          // batch-tracked replacements (and kits with batch-tracked parts)
          // must say which batch the stock leaves from — Zoho code 2302
          const warehouseId = invoice.line_items.find((l) => l.warehouse_id)?.warehouse_id;
          const body = { ...plan.exchangeInvoiceBody, line_items: await withOutBatches(plan.exchangeInvoiceBody.line_items as Record<string, unknown>[], warehouseId, token) };
          await save({ zoho_exchange_invoice_id: `PENDING:${crypto.randomUUID()}` });
          found = await createInvoice(body, token);
        }
        await save({ zoho_exchange_invoice_id: found.id, zoho_exchange_invoice_number: found.number });
      }

      // 3. apply the note — against live balances, so a rerun never over-applies
      const cnId = row.zoho_creditnote_id!;
      if (plan.applyToExchangeAed > 0 && !(row.applied_to_exchange_aed > 0) && isReal(row.zoho_exchange_invoice_id)) {
        const cn = await getCreditNoteLive(cnId, token);
        const ex = await getInvoiceMoneySummary(row.zoho_exchange_invoice_id!, token);
        const amt = r2(Math.min(plan.applyToExchangeAed, cn.balance, ex.balance));
        if (amt > 0) await applyCreditNoteToInvoices(cnId, [{ invoice_id: row.zoho_exchange_invoice_id!, amount_applied: amt }], token);
        await save({ applied_to_exchange_aed: amt });
      }
      if (plan.applyToInvoiceAed > 0 && !(row.applied_to_invoice_aed > 0)) {
        const cn = await getCreditNoteLive(cnId, token);
        const orig = await getInvoiceMoneySummary(invoice.invoice_id, token);
        const amt = r2(Math.min(plan.applyToInvoiceAed, cn.balance, orig.balance));
        if (amt > 0) await applyCreditNoteToInvoices(cnId, [{ invoice_id: invoice.invoice_id, amount_applied: amt }], token);
        await save({ applied_to_invoice_aed: amt });
      }

      // 4. read back what Zoho now holds
      const cn = await getCreditNoteLive(cnId, token);
      const orig = await getInvoiceMoneySummary(invoice.invoice_id, token);
      const ex = isReal(row.zoho_exchange_invoice_id) ? await getInvoiceMoneySummary(row.zoho_exchange_invoice_id!, token) : null;
      await save({
        status: "posted", posted_at: new Date().toISOString(), error: null,
        refund_due_aed: r2(cn.balance), customer_owes_aed: r2(orig.balance + (ex?.balance ?? 0)),
      });
      await OrderAdjustmentsRepository.setOrderOps(order.uid, { kind: input.kind, creditAed: plan.creditAed });

      // keep the report indexes current without waiting for a Zoho refresh
      const org = (await listZohoConnections()).find((c) => c.id === connectionId)?.label ?? connectionId;
      await ZohoInvoiceIndexRepository.upsertFromDocs([
        { kind: "creditnote", org, id: cn.id, number: cn.number, reference: plan.references.creditNote, customer: invoice.customer_name ?? order.order_number,
          date: cn.date, status: cn.status, total: cn.total, balance: cn.balance },
        ...(ex ? [{ kind: "invoice" as const, org, id: ex.invoice_id, number: ex.invoice_number, reference: plan.references.exchangeInvoice,
          customer: invoice.customer_name ?? order.order_number, date: ex.date, status: ex.status, total: ex.total, balance: ex.balance }] : []),
      ]).catch(() => undefined);

      return {
        ok: true, dryRun: false, plan, adjustment: row,
        documents: { creditNote: cn.number, exchangeInvoice: ex?.invoice_number ?? null },
        readBack: { creditNoteBalance: cn.balance, invoiceBalance: orig.balance, exchangeBalance: ex?.balance ?? null },
        message: `Booked in Zoho: credit note ${cn.number} (AED ${cn.total.toFixed(2)}, open ${cn.balance.toFixed(2)})` +
          (ex ? `, exchange invoice ${ex.invoice_number} (AED ${ex.total.toFixed(2)}, owed ${ex.balance.toFixed(2)})` : "") +
          `; ${orig.invoice_number} balance now AED ${orig.balance.toFixed(2)}.`,
      };
    });
  } catch (e) {
    const msg = (e as Error).message;
    await save({ status: "error", error: msg }).catch(() => undefined);
    return { ok: false, dryRun: false, plan, adjustment: row, documents: { creditNote: row.zoho_creditnote_number || null, exchangeInvoice: row.zoho_exchange_invoice_number || null }, readBack: null,
      message: `Stopped: ${msg}. Running Post again resumes where it stopped — documents already created are found by reference, not duplicated.` };
  }
}

/** Undo an adjustment the app recorded. Zoho documents are never deleted from
 *  here: a posted one with documents must be removed in Zoho first. */
export async function undoAdjustment(uid: string, id: string): Promise<{ ok: boolean; message: string }> {
  const row = (await OrderAdjustmentsRepository.forOrder(uid)).find((a) => a.id === id);
  if (!row) return { ok: false, message: "Adjustment not found" };
  if (isReal(row.zoho_payment_id)) {
    const still = await withZohoOrg(row.zoho_connection_id, async () => customerPaymentExists(row.zoho_payment_id!, await getScopedAccessToken())).catch(() => true);
    if (still) return { ok: false, message: `Payment ${receivedReference(row.order_number)} still exists in Zoho. Delete it in Zoho first, then undo here.` };
  }
  const hasDocs = isReal(row.zoho_creditnote_id) || isReal(row.zoho_exchange_invoice_id);
  if (hasDocs) {
    const stillThere = await withZohoOrg(row.zoho_connection_id, async () => {
      const token = await getScopedAccessToken();
      try { await getCreditNoteLive(row.zoho_creditnote_id!, token); return true; } catch { return false; }
    }).catch(() => true);
    if (stillThere) {
      return { ok: false, message: `Credit note ${row.zoho_creditnote_number}${row.zoho_exchange_invoice_number ? ` and invoice ${row.zoho_exchange_invoice_number}` : ""} still exist in Zoho. Delete them in Zoho first, then undo here.` };
    }
  }
  await OrderAdjustmentsRepository.remove(id);
  const left = (await OrderAdjustmentsRepository.forOrder(uid)).find((a) => a.status === "posted");
  await OrderAdjustmentsRepository.setOrderOps(uid, left ? { kind: left.kind, creditAed: left.credit_aed } : null);
  return { ok: true, message: "Adjustment removed — the order counts as it did before." };
}

/** Zoho "Deposit To" accounts in an org, with the one suggested for a gateway
 *  (its clearing account, e.g. "TABBY AED"). */
export async function depositAccountsFor(connectionId: string, gateway: string, currency = "AED") {
  return withZohoOrg(connectionId, async () => {
    const opts = await fetchPostingOptions(await getScopedAccessToken());
    // Checkout always books to "Checkout - AED", never "Checkout - SAR"
    // (business rule in lib/finance/gateway-account-map.ts).
    const cur = /checkout/i.test(gateway) ? "AED" : currency;
    const suggested = suggestPostingAccounts({ provider: gateway, currency: cur }, opts).depositAccountId;
    return { accounts: opts.depositAccounts, suggestedId: suggested };
  });
}

/** "Received — close invoice": the money for this order came in some other
 *  way (paid with another order, by hand, bank transfer). One customer payment
 *  (MAN/<order>/PAY) into the chosen account closes the invoice. */
async function runReceived(input: RunInput, order: OrderLite, date: string): Promise<RunResult> {
  const none = { creditNote: null, exchangeInvoice: null };
  const fail = (message: string): RunResult => ({ ok: false, dryRun: input.dryRun, plan: null, adjustment: null, documents: none, readBack: null, message });
  if (!input.connectionId || !input.invoiceId) return fail("No Zoho invoice chosen for this order. Pick one, or use “Mark only”.");
  if (!input.depositAccountId) return fail("Pick the Zoho account the money went into (the gateway's clearing account, or the bank).");
  const connectionId = input.connectionId;
  const invoice = await loadInvoice(connectionId, input.invoiceId);
  if (String(invoice.status).toLowerCase() === "void") return fail(`Invoice ${invoice.invoice_number} is void in Zoho.`);
  const amount = r2(Number(input.receivedAed) || invoice.balance);
  if (invoice.balance <= 0.01) return fail(`Invoice ${invoice.invoice_number} is already paid in Zoho — nothing to close. Use “Mark only” to mark the order received.`);
  if (amount <= 0) return fail("Enter the amount received.");
  if (amount > invoice.balance + 0.01) return fail(`AED ${amount.toFixed(2)} is more than the invoice's open AED ${invoice.balance.toFixed(2)}.`);
  const via = (input.receivedVia || order.gateway || "").trim();
  const ref = receivedReference(order.order_number);
  const left = r2(invoice.balance - amount);
  const steps = [
    `Payment ${ref} of AED ${amount.toFixed(2)} via ${via} into “${input.depositAccountName || input.depositAccountId}”, applied to ${invoice.invoice_number}.`,
    left > 0.01 ? `${invoice.invoice_number} keeps AED ${left.toFixed(2)} open.` : `${invoice.invoice_number} closes (paid).`,
  ];
  const plan = { ok: true, error: null, creditAed: 0, returnedGrossAed: 0, deductAed: 0, exchangeTotalAed: 0, applyToExchangeAed: 0,
    applyToInvoiceAed: amount, refundDueAed: 0, customerOwesAed: left, steps } as unknown as AdjustmentPlan;
  if (input.dryRun) return { ok: true, dryRun: true, plan, adjustment: null, documents: none, readBack: null, message: "Preview only — nothing written." };

  const existing = await OrderAdjustmentsRepository.forOrder(order.uid);
  for (const a of existing) if (a.status !== "posted" && a.kind !== "received" && !isReal(a.zoho_creditnote_id)) await OrderAdjustmentsRepository.remove(a.id);
  let row = existing.find((a) => a.status !== "posted" && a.kind === "received")
    ?? await OrderAdjustmentsRepository.insert({
      order_uid: order.uid, order_number: order.order_number, store_id: order.store_id, kind: "received", adjustment_date: date,
      zoho_connection_id: connectionId, zoho_invoice_id: invoice.invoice_id, zoho_invoice_number: invoice.invoice_number, invoice_total: invoice.total,
      received_aed: amount, received_via: via, deposit_account_id: input.depositAccountId, deposit_account_name: input.depositAccountName ?? "",
      note: input.note ?? "", status: "draft", created_by: input.actor,
    });
  const save = async (patch: Partial<OrderAdjustmentRow>) => { await OrderAdjustmentsRepository.update(row.id, patch); row = { ...row, ...patch }; };
  try {
    return await withZohoOrg(connectionId, async () => {
      const token = await getScopedAccessToken();
      let paymentId = isReal(row.zoho_payment_id) ? row.zoho_payment_id : null;
      if (!paymentId && row.zoho_payment_id?.startsWith("PENDING:")) {
        paymentId = await findOurPaymentOnInvoice({ customerId: invoice.customer_id, invoiceNumber: invoice.invoice_number, references: [ref], accessToken: token });
      }
      if (!paymentId) {
        await save({ zoho_payment_id: `PENDING:${crypto.randomUUID()}`, error: null });
        paymentId = await createCustomerPayment(buildCustomerPaymentBody({
          customerName: invoice.customer_name ?? order.order_number, invoiceReferenceNumber: order.order_number, amount, amountApplied: amount,
          balance: invoice.balance, gateway: via, bankReference: ref, referenceNumberOverride: ref, date, accountId: input.depositAccountId,
          description: `Received via ${via} · order ${order.order_number} · closed by hand${input.note?.trim() ? `: ${input.note.trim()}` : ""}`,
          customerId: invoice.customer_id, invoiceId: invoice.invoice_id,
        } as Parameters<typeof buildCustomerPaymentBody>[0]), token);
      }
      await save({ zoho_payment_id: paymentId });
      const after = await getInvoiceMoneySummary(invoice.invoice_id, token);
      await save({ status: "posted", posted_at: new Date().toISOString(), customer_owes_aed: r2(after.balance), error: null });
      await OrderAdjustmentsRepository.setOrderOps(order.uid, { kind: "received", creditAed: 0 });
      return { ok: true, dryRun: false, plan, adjustment: row, documents: none, readBack: { creditNoteBalance: null, invoiceBalance: after.balance, exchangeBalance: null },
        message: `Booked in Zoho: payment ${ref} AED ${amount.toFixed(2)} via ${via}; ${after.invoice_number} is now ${after.status} (balance AED ${after.balance.toFixed(2)}).` };
    });
  } catch (e) {
    const msg = (e as Error).message;
    await save({ status: "error", error: msg }).catch(() => undefined);
    return { ...fail(`Stopped: ${msg}. Running Post again resumes — the payment is found by its reference, not duplicated.`), plan, adjustment: row };
  }
}
