// import { NextResponse } from "next/server";
// import { runReconciliation } from "@/lib/reconciliation/engine";
// // getZohoAccessToken — same helper /api/settlements/publish uses. If yours
// // is named differently, swap the import; the shape is the same.
// import { getAccessToken } from "@/lib/integrations/zoho";
// import { normalizeRef } from "@/lib/inventory-compare";

// export const maxDuration = 60;

// // Match whichever API base createZohoCustomerPayment uses in your zoho.ts
// // (yours is the Inventory API — Books 401s under the current token scope).
// const API_BASE = "https://www.zohoapis.com/books/v3";

// export type ZohoInvoiceStatus =
//   | "paid" | "overdue" | "unpaid" | "partially_paid"
//   | "sent" | "draft" | "viewed" | "void";

// type ZohoInvoiceRow = {
//   invoice_id: string;
//   reference_number: string;
//   status: ZohoInvoiceStatus;
//   balance: number;
//   total: number;
//   customer_name:string;
// };

// type ZohoInvoiceListRow = {
//   invoice_id: string;
//   invoice_number: string;
//   reference_number: string;
//   status: ZohoInvoiceStatus;
//   balance: number;
//   total: number;
// };
// export type InvoiceStatus =
//   | { status: "paid_external"; invoiceIds: string[]; count: number }
//   | { status: "overdue"; invoiceIds: string[]; count: number; unpaidBalance: number }
//   | { status: "unpaid"; invoiceIds: string[]; count: number; unpaidBalance: number }
//   | { status: "not_in_zoho" };


// export type InvoiceStatusesResponse = {
//   bankLineId: string;
//   statuses: Record<string, InvoiceStatus>;
// };

// async function lookupInvoices(ref: string, accessToken: string, orgId: string): Promise<ZohoInvoiceListRow[]> {
//   const normalized = normalizeRef(ref);

//   const tryFilter = async (refValue: string): Promise<ZohoInvoiceListRow[]> => {
//     const qs = new URLSearchParams({ organization_id: orgId, reference_number: refValue });
//     const res = await fetch(`${API_BASE}/invoices?${qs}`, {
//       headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
//       cache: "no-store",
//     });
//     if (!res.ok) return [];
//     const json = await res.json();
//     const rows: ZohoInvoiceListRow[] = json.invoices ?? [];
//     // Zoho's server filter is prefix-tolerant — narrow to exact normalized match.
//     return rows.filter((r) => normalizeRef(r.reference_number || "") === normalized);
//   };

//   let matches = await tryFilter(ref);
//   if (matches.length === 0) {
//     // Same WA/SA/UAE/KSA tolerance the recon engine's refCandidates applies.
//     const bare = ref.replace(/^(WA|UAE|KSA|WOO|SA)/i, "");
//     if (bare !== ref) matches = await tryFilter(bare);
//   }
//   return matches;
// }

// function aggregate(rows: ZohoInvoiceListRow[]): InvoiceStatus {
//   if (rows.length === 0) return { status: "not_in_zoho" };

//   const invoiceIds = rows.map((r) => r.invoice_id);
//   const count = rows.length;
//   const unpaidBalance = +rows.reduce((s, r) => s + (r.balance || 0), 0).toFixed(2);

//   // Balance 0 on every match — every invoice is settled, however it got there
//   // (paid by us, paid manually in Zoho, credited off, exchanged).
//   const allPaid = rows.every((r) => (r.balance || 0) <= 0.01);
//   if (allPaid) return { status: "paid_external", invoiceIds, count };

//   const anyOverdue = rows.some((r) => r.status === "overdue");
//   if (anyOverdue) return { status: "overdue", invoiceIds, count, unpaidBalance };

//   return { status: "unpaid", invoiceIds, count, unpaidBalance };
// }

// async function mapWithConcurrency<T, R>(items: T[], mapper: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
//   const out: R[] = new Array(items.length);
//   let i = 0;
//   await Promise.all(
//     Array.from({ length: Math.min(concurrency, items.length) }, async () => {
//       while (i < items.length) {
//         const idx = i++;
//         out[idx] = await mapper(items[idx]);
//       }
//     }),
//   );
//   return out;
// }

// export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
//   const { id } = await params;

//   try {
//     const line = (await runReconciliation()).find((l) => l.id === id);
//     if (!line) return NextResponse.json({ error: `No reconciliation line ${id}` }, { status: 404 });
//     if (!line.confirmedBy) return NextResponse.json({ error: "Line is not confirmed" }, { status: 400 });

//     const refs = [
//       ...new Set([
//         ...line.resolvedOrders,
//         ...line.refundedOrders,
//         ...line.unresolvedRefs,
//         ...line.transactions.map((t) => t.ref),
//       ]),
//     ].filter(Boolean);

//     if (refs.length === 0) {
//       return NextResponse.json({ bankLineId: id, statuses: {} } satisfies InvoiceStatusesResponse);
//     }

//     const accessToken = await getAccessToken();
//     const orgId = process.env.ZOHO_ORGANIZATION_ID!;

//     const looked = await mapWithConcurrency(
//       refs,
//       async (ref) => [ref, aggregate(await lookupInvoices(ref, accessToken, orgId))] as const,
//       5,
//     );

//     const statuses: InvoiceStatusesResponse["statuses"] = {};
//     for (const [ref, status] of looked) statuses[ref] = status;

//     return NextResponse.json({ bankLineId: id, statuses } satisfies InvoiceStatusesResponse);
//   } catch (e) {
//     console.error(`invoice-status GET failed for line ${id}:`, e);
//     return NextResponse.json({ error: (e as Error).message }, { status: 500 });
//   }
// }
// // One server-side ?reference_number=X query per order. Zoho's list endpoint
// // has no "in" filter, so any attempt to batch it forces paginating the whole
// // org — that's what killed the previous attempt at 33s. 24 refs at ~300ms
// // each with concurrency 5 comes in around 2s, well inside route timeout.
// //
// // Falls back to the numeric tail (SA3544 → 3544) when the exact match misses
// // — same WA/SA/UAE/KSA prefix tolerance refCandidates() applies in the recon
// // engine, otherwise a store-prefixed ref would be silently reported missing.
// async function lookupInvoice(ref: string, accessToken: string, orgId: string): Promise<ZohoInvoiceRow | null> {
//   const tryFilter = async (refValue: string): Promise<ZohoInvoiceRow | null> => {
//     const qs = new URLSearchParams({ organization_id: orgId, reference_number: refValue });
//     const res = await fetch(`${API_BASE}/invoices?${qs}`, {
//       headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
//       cache: "no-store",
//     });
//     if (!res.ok) return null;
//     const json = await res.json();
//     const rows: ZohoInvoiceRow[] = json.invoices ?? [];
//     console.log(rows,"her s all rows from zoho",refValue);
//     // Zoho's server filter can be prefix-tolerant — prefer an exact match
//     // when the response has more than one row, else take the single hit.
//     console.log(rows.find((r) => r.customer_name.toLowerCase().includes(refValue.toLowerCase())),"her s the row from zoho",refValue);
//     return rows.find((r) => r.customer_name.toLowerCase().includes(refValue.toLowerCase())) ?? rows[0] ?? null;
//   };

//   const exact = await tryFilter(ref);
//   if (exact) return exact;
//   const bare = ref.replace(/^(WA|UAE|KSA|WOO|SA)/i, "");
//   if (bare !== ref) {
//     const stripped = await tryFilter(bare);
//     if (stripped) return stripped;
//   }
//   return null;
// }

import { NextResponse } from "next/server";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { findZohoInvoiceCandidates, getAccessToken } from "@/lib/integrations/zoho";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { bankScaleFor, isCrossBorderCurrency, pickInvoiceForOrder } from "@/lib/finance/settlement-posting";

export const maxDuration = 60;

export type ZohoInvoiceStatus =
  | "paid" | "overdue" | "unpaid" | "partially_paid"
  | "sent" | "draft" | "viewed" | "void";

export type InvoiceStatus =
  | {
      status: ZohoInvoiceStatus;
      invoiceId: string;
      balance: number;
      /** The invoice's own total, for display next to a closed invoice. */
      total?: number;
      invoiceNumber?: string;
      /** This came from the stored snapshot, not a fresh Zoho read. */
      cached?: boolean;
      checkedAt?: string | null;
      ambiguous?: string;
    }
  | { status: "not_found" };

export type InvoiceStatusesResponse = {
  bankLineId: string;
  statuses: Record<string, InvoiceStatus>;
  /** How many orders had to be read from Zoho on this request. */
  fetched: number;
  /** How many were served from the stored snapshot — i.e. calls not made. */
  cached: number;
  /** How many have never been read from Zoho at all. */
  unchecked: number;
};

// One invoice per order, chosen the same way booking chooses it
// (lib/finance/settlement-posting.ts → pickInvoiceForOrder): the invoice this
// order was already booked against, else the one matching the gateway's
// amount. Taking "the first match" showed the wrong invoice's status whenever
// Zoho held two for one order.
async function checkInvoice(
  ref: string,
  accessToken: string,
  orgId: string,
  hint: {
    expectedAmount: number;
    crossBorder: boolean;
    orderCurrency: string | null;
    preferredInvoiceId: string | null;
  },
): Promise<InvoiceStatus> {
  let candidates;
  try {
    candidates = await findZohoInvoiceCandidates(ref, accessToken, orgId);
  } catch {
    return { status: "not_found" };
  }
  const picked = pickInvoiceForOrder(candidates, { orderNumber: ref, ...hint });
  if (!picked.invoice) {
    const open = candidates.find((c) => Number(c.balance) > 0.01) ?? candidates[0];
    return open
      ? {
          status: open.status as ZohoInvoiceStatus, invoiceId: open.invoice_id,
          balance: Number(open.balance), total: Number(open.total ?? 0),
          invoiceNumber: open.invoice_number, ambiguous: picked.error,
        }
      : { status: "not_found" };
  }
  return {
    status: picked.invoice.status as ZohoInvoiceStatus,
    invoiceId: picked.invoice.invoice_id,
    balance: Number(picked.invoice.balance),
    total: Number(picked.invoice.total ?? 0),
    invoiceNumber: picked.invoice.invoice_number,
  };
}

async function mapWithConcurrency<T, R>(items: T[], mapper: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await mapper(items[idx]);
      }
    }),
  );
  return out;
}

const bareRef = (r: string) => r.replace(/^#/, "").replace(/^(WA|UAE|KSA|WOO|SA)/i, "");

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const line = (await runReconciliation()).find((l) => l.id === id);
    if (!line) return NextResponse.json({ error: `No reconciliation line ${id}` }, { status: 404 });
    if (!line.confirmedBy) return NextResponse.json({ error: "Line is not confirmed" }, { status: 400 });

    const refs = [
      ...new Set([
        ...line.resolvedOrders,
        ...line.refundedOrders,
        ...line.unresolvedRefs,
        ...line.transactions.map((t) => t.ref),
      ]),
    ].filter(Boolean);

    if (refs.length === 0) return NextResponse.json({ bankLineId: id, statuses: {} });

    const crossBorder = isCrossBorderCurrency(line.payout?.currency);
    const bankScale = bankScaleFor({
      crossBorder, bankAmount: line.bankAmount, payoutNet: line.payout?.net ?? 0,
      sharesAtBankRate: line.payout?.fxSource === "bank",
    });

    // Each Zoho lookup is a `customer_name_startswith` invoice search pulling
    // up to 200 rows, serialised through the daily-budget throttle — one or
    // two PER ORDER. Re-running that every time the panel opens burned dozens
    // of calls to redisplay figures that had not moved. Booking already stores
    // what Zoho said (settlement_records.zoho_invoice_*), so serve from that
    // and spend calls only on orders never looked up. ?refresh=1 forces a
    // re-read when the founder wants to confirm against Zoho right now.
    // Invoice STATUS must be live: a manager can reopen a paid invoice in Zoho
    // (paid -> unpaid/overdue) and this panel has to show that, so it is always
    // read fresh rather than served from the stored snapshot. The snapshot is a
    // fallback for when a lookup fails, and what lets the amount still render.
    //
    // The cost of that truthfulness is one `customer_name_startswith` search
    // per order (two when the store-prefixed ref misses and it retries bare),
    // each paced by the throttle and preceded by a quota RPC. Keep it to the
    // orders that can actually carry a payment: refund and unmatched lines have
    // no invoice to close.
    const bookedInvoice = new Map<string, string>();
    const snapshots = new Map<string, InvoiceStatus>();
    // A SAR order on an AED payout is priced at two different rates, so its
    // invoice sits a couple of percent off the gateway's figure. The picker
    // needs to know that or it refuses to choose between two live invoices.
    const orderCurrencies = new Map<string, string | null>();
    for (const s of await SettlementsRepository.listByBankLineId(id)) {
      orderCurrencies.set(s.order_number, s.order_currency ?? null);
      orderCurrencies.set(bareRef(s.order_number), s.order_currency ?? null);
      if (s.zoho_invoice_id) {
        bookedInvoice.set(s.order_number, s.zoho_invoice_id);
        bookedInvoice.set(bareRef(s.order_number), s.zoho_invoice_id);
      }
      if (!s.zoho_invoice_checked_at || s.zoho_invoice_balance == null || !s.zoho_invoice_id) continue;
      const snap: InvoiceStatus = {
        status: (s.zoho_invoice_status || "unpaid") as ZohoInvoiceStatus,
        invoiceId: s.zoho_invoice_id,
        balance: Number(s.zoho_invoice_balance),
        total: s.zoho_invoice_total == null ? undefined : Number(s.zoho_invoice_total),
        invoiceNumber: s.zoho_invoice_number ?? undefined,
        cached: true,
        checkedAt: s.zoho_invoice_checked_at,
      };
      snapshots.set(s.order_number, snap);
      snapshots.set(bareRef(s.order_number), snap);
    }

    const accessToken = await getAccessToken();
    const orgId = process.env.ZOHO_ORGANIZATION_ID!;

    // The throttle serialises Zoho calls anyway; concurrency only overlaps the waits.
    const looked = await mapWithConcurrency(refs, async (ref) => {
      const tx = line.transactions.find((t) => t.ref === ref || bareRef(t.ref) === bareRef(ref));
      // A manually linked line looks its invoice up by the order it points at.
      const lookup = tx?.orderNumber ?? ref;
      const status = await checkInvoice(lookup, accessToken, orgId, {
        expectedAmount: (tx?.grossShare ?? 0) * bankScale,
        crossBorder,
        orderCurrency: orderCurrencies.get(lookup) ?? orderCurrencies.get(bareRef(lookup)) ?? null,
        preferredInvoiceId: bookedInvoice.get(lookup) ?? bookedInvoice.get(bareRef(lookup)) ?? null,
      });
      return [ref, lookup, status] as const;
    }, 5);

    const statuses: Record<string, InvoiceStatus> = {};
    let fellBack = 0;
    for (const [ref, lookup, status] of looked) {
      if (status.status === "not_found") {
        // Zoho didn't answer, or the invoice genuinely isn't there. A stored
        // snapshot at least keeps the amount on screen instead of a blank row;
        // it is flagged `cached` so the UI never passes it off as live.
        const snap = snapshots.get(lookup) ?? snapshots.get(bareRef(lookup));
        if (snap) { statuses[ref] = snap; fellBack += 1; continue; }
      }
      statuses[ref] = status;
    }

    await SettlementsRepository.saveInvoiceSnapshots(
      id,
      looked
        .filter((x): x is readonly [string, string, Extract<InvoiceStatus, { invoiceId: string }>] =>
          "invoiceId" in x[2])
        .map(([, lookup, st]) => ({
          orderNumber: lookup,
          zoho_invoice_number: st.invoiceNumber ?? null,
          zoho_invoice_status: st.status,
          zoho_invoice_balance: st.balance,
          zoho_invoice_total: st.total ?? null,
        })),
    ).catch(() => { /* a cache write must never fail the read */ });

    return NextResponse.json({
      bankLineId: id,
      statuses,
      fetched: looked.length,
      cached: fellBack,
      unchecked: 0,
    });
  } catch (e) {
    console.error(`invoice-status GET failed for line ${id}:`, e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
