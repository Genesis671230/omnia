// GET /api/invoices/sheet-matches?from=&to=
//
// Joins the payments-tracking Google Sheet (ops-confirmed "Payment
// Received" rows) against Zoho invoices still marked unpaid, by Order #.
// Read-only both sides — this never writes to Zoho or the sheet; it's the
// data behind the "From payments sheet" mode in the invoices workbench,
// which lets Finance review and then bulk-close the matched invoices.
//
// The sheet read and the Zoho fetch run independently (allSettled, not
// all) — Zoho's daily quota is easy to exhaust from elsewhere in the app,
// and when that happens this route still has something useful to show:
// the raw sheet rows, just without invoice numbers/balances/flags to match
// them against. zohoUnavailable tells the UI which mode it's in.

import { NextRequest, NextResponse } from "next/server";
import { buildWorkbenchInvoices, defaultWorkbenchFrom } from "@/lib/finance/build-workbench-invoices";
import { readConfirmedPaymentRows, paymentsSheetConfigured, type PaymentSheetRow } from "@/lib/finance/payments-sheet";
import { zohoPaymentModeFor } from "@/lib/integrations/zoho";
import type { SheetInvoiceMatch, SheetMatchFlag, SheetMatchesResponse, UnmatchedSheetRow, WorkbenchInvoice } from "@/lib/finance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const from = p.get("from") ?? defaultWorkbenchFrom();
  const to = p.get("to") ?? new Date().toISOString().slice(0, 10);

  if (!paymentsSheetConfigured()) {
    return NextResponse.json(
      { error: "Payments sheet not configured — set GOOGLE_SHEETS_PAYMENTS_SPREADSHEET_ID (and the shared GOOGLE_SERVICE_ACCOUNT_* vars)" },
      { status: 503 },
    );
  }

  try {
    const [workbenchResult, sheetRowsResult] = await Promise.allSettled([
      buildWorkbenchInvoices({ from, to, status: "unpaid" }),
      readConfirmedPaymentRows(),
    ]);

    // The sheet is the primary data source for this route — if that fails
    // there's genuinely nothing to show, unlike a Zoho failure below.
    if (sheetRowsResult.status === "rejected") {
      throw sheetRowsResult.reason;
    }
    const sheetRows = sheetRowsResult.value;
    const sheetRowsSummary = sheetRows.map((r) => ({
      tab: r.tab, rowNumber: r.rowNumber, orderNumber: r.orderNumber!,
      partyRaw: r.party.raw, paymentDate: r.paymentReceivedDate,
    }));

    if (workbenchResult.status === "rejected") {
      const response: SheetMatchesResponse = {
        matches: [], unmatchedSheetRows: [], from, to,
        zohoUnavailable: true,
        zohoError: (workbenchResult.reason as Error).message,
        sheetRows: sheetRowsSummary,
      };
      return NextResponse.json(response);
    }
    const workbench = workbenchResult.value;

    const invoicesByOrder = new Map<string, WorkbenchInvoice[]>();
    for (const inv of workbench.invoices) {
      if (!inv.orderNumber) continue;
      const arr = invoicesByOrder.get(inv.orderNumber) ?? [];
      arr.push(inv);
      invoicesByOrder.set(inv.orderNumber, arr);
    }

    const sheetRowsByOrder = new Map<string, PaymentSheetRow[]>();
    for (const row of sheetRows) {
      if (!row.orderNumber) continue;
      const arr = sheetRowsByOrder.get(row.orderNumber) ?? [];
      arr.push(row);
      sheetRowsByOrder.set(row.orderNumber, arr);
    }

    const matches: SheetInvoiceMatch[] = [];
    const unmatchedSheetRows: UnmatchedSheetRow[] = [];

    for (const row of sheetRows) {
      if (!row.orderNumber) continue;
      const candidateInvoices = invoicesByOrder.get(row.orderNumber);
      if (!candidateInvoices || candidateInvoices.length === 0) {
        unmatchedSheetRows.push({ tab: row.tab, rowNumber: row.rowNumber, orderNumber: row.orderNumber });
        continue;
      }

      const sameOrderRows = sheetRowsByOrder.get(row.orderNumber) ?? [];
      const paymentMode = row.party.canonical ? zohoPaymentModeFor(row.party.canonical) : "Credit Card";

      for (const inv of candidateInvoices) {
        const flags: SheetMatchFlag[] = [];
        if (row.party.isSplit) flags.push("split-payment");
        if (row.isExchange) flags.push("exchange-party");
        if (inv.isExchange) flags.push("exchange-invoice");
        if (row.isDuplicateFlagged) flags.push("duplicate-flagged");
        if (!row.paymentReceivedDate) flags.push("no-payment-date");
        if (sameOrderRows.length > 1) flags.push("multiple-sheet-rows");
        // "account-unresolved" is computed client-side, against the
        // already-cached Zoho account list — see sheet-match-panel.tsx.

        matches.push({
          invoiceId: inv.invoiceId,
          invoiceNumber: inv.invoiceNumber,
          orderNumber: row.orderNumber,
          customerName: inv.customerName,
          balance: inv.balance,
          currency: inv.currency,
          invoiceGateway: inv.gateway,
          invoiceIsExchange: inv.isExchange,
          sheetTab: row.tab,
          sheetRow: row.rowNumber,
          sheetPartyRaw: row.party.raw,
          sheetGateway: row.party.canonical,
          region: row.region,
          paymentDate: row.paymentReceivedDate,
          paymentMode,
          flags,
        });
      }
    }

    // Newest payment date first, so recent gaps surface at the top.
    matches.sort((a, b) => (b.paymentDate ?? "").localeCompare(a.paymentDate ?? ""));

    const response: SheetMatchesResponse = {
      matches, unmatchedSheetRows, from, to,
      zohoUnavailable: false, zohoError: null,
      sheetRows: sheetRowsSummary,
    };
    return NextResponse.json(response);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
