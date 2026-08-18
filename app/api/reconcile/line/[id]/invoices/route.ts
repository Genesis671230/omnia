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
import { getAccessToken } from "@/lib/integrations/zoho";

export const maxDuration = 60;
const API_BASE = "https://www.zohoapis.com/books/v3";

export type ZohoInvoiceStatus =
  | "paid" | "overdue" | "unpaid" | "partially_paid"
  | "sent" | "draft" | "viewed" | "void";

export type InvoiceStatus =
  | { status: ZohoInvoiceStatus; invoiceId: string; balance: number }
  | { status: "not_found" };

export type InvoiceStatusesResponse = {
  bankLineId: string;
  statuses: Record<string, InvoiceStatus>;
};

// One invoice per order. Server narrows by customer_name, local .includes
// picks the match — same pattern as findZohoInvoice() in lib/integrations/zoho.ts.
// If Zoho returned any invoice for this customer, take the first one and
// use its status verbatim. No aggregation, no fallbacks.
async function checkInvoice(ref: string, accessToken: string, orgId: string): Promise<InvoiceStatus> {
  const qs = new URLSearchParams({ organization_id: orgId, customer_name_contains: ref });
  const res = await fetch(`${API_BASE}/invoices?${qs}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, "X-com-zoho-books-organizationid": orgId },
    cache: "no-store",
  });
  if (!res.ok) return { status: "not_found" };
  const json = await res.json();
  const invoices = json.invoices ?? [];
  const needle = ref.toLowerCase();
  const invoice = invoices.find((inv: any) => (inv.customer_name || "").toLowerCase().includes(needle));
  if (!invoice) return { status: "not_found" };
  return { status: invoice.status, invoiceId: invoice.invoice_id, balance: invoice.balance };
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

    const accessToken = await getAccessToken();
    const orgId = process.env.ZOHO_ORGANIZATION_ID!;

    const looked = await mapWithConcurrency(refs, async (ref) => [ref, await checkInvoice(ref, accessToken, orgId)] as const, 5);
    const statuses: Record<string, InvoiceStatus> = {};
    for (const [ref, status] of looked) statuses[ref] = status;

    return NextResponse.json({ bankLineId: id, statuses });
  } catch (e) {
    console.error(`invoice-status GET failed for line ${id}:`, e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}