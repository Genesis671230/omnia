"use client";

/* "From payments sheet" mode of the invoices workbench — matches the
   payments-tracking Google Sheet (ops-confirmed "Payment Received" rows)
   against unpaid Zoho invoices by Order #, resolves each row's actual Zoho
   clearing account (Tabby KSA vs Tabby UAE vs Telr Gateway, etc — see
   lib/finance/gateway-account-map.ts), and lets Finance review + bulk close
   the clean matches straight into the correct account.

   Account resolution runs entirely client-side against the Zoho account
   list already cached by ZohoSettingsProvider (one fetch per reconciliation
   visit — see lib/hooks/use-zoho-settings.tsx). This must never trigger a
   fresh Zoho call on its own; that's the whole reason it isn't done server
   side in /api/invoices/sheet-matches. */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  type ColumnDef, type RowSelectionState,
  flexRender, getCoreRowModel, useReactTable,
} from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useZohoSettings } from "@/lib/hooks/use-zoho-settings";
import { resolveZohoAccountForSheetRow } from "@/lib/finance/gateway-account-map";
import { SheetMatchCloseDialog, type CloseGroup } from "./sheet-match-close-dialog";
import type { SheetInvoiceMatch, SheetMatchesResponse, SheetMatchFlag } from "@/lib/finance/types";

const AED = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const aed = (n: number) => AED.format(n);

const FLAG_LABEL: Record<SheetMatchFlag, string> = {
  "split-payment": "Split payment",
  "exchange-party": "Exchange",
  "exchange-invoice": "Exchange invoice",
  "duplicate-flagged": "Duplicate flagged",
  "no-payment-date": "No payment date",
  "account-unresolved": "Account unresolved",
  "multiple-sheet-rows": "Multiple sheet rows",
};

type ResolvedMatch = SheetInvoiceMatch & {
  resolvedAccountId: string | null;
  resolvedAccountName: string;
  effectiveFlags: SheetMatchFlag[];
};

async function fetchSheetMatches(from: string, to: string): Promise<SheetMatchesResponse> {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`/api/invoices/sheet-matches?${params}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// The whole point of this panel is catching stale gaps — a sheet row
// confirmed paid weeks ago that Zoho still shows unpaid — so the default
// window needs to reach further back than the manual workbench's 30 days.
// Wider still costs more Zoho pagination (the exact thing this feature's
// sibling fix in ZohoSettingsProvider was built to protect against), so
// 90 days is a middle ground, not a hard limit — worth a real date picker
// if 90 days turns out too narrow in practice.
function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

const rowVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: Math.min(i, 20) * 0.012, duration: 0.18 } }),
};

export function SheetMatchPanel() {
  const [from] = useState(defaultFrom());
  const [to] = useState(new Date().toISOString().slice(0, 10));
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [seededSelection, setSeededSelection] = useState(false);
  const [closing, setClosing] = useState<CloseGroup[] | null>(null);

  const { config: zohoConfig } = useZohoSettings();
  const allAccounts = zohoConfig?.allAccounts ?? [];
  const defaultAccountId =  "2330082000000236001";
  const defaultAccount = useMemo(() => allAccounts.find((a) => a.account_id === defaultAccountId) ?? null, [allAccounts, defaultAccountId]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["sheet-matches", from, to],
    queryFn: () => fetchSheetMatches(from, to),
  });

  // Resolve each match's real Zoho clearing account here, client-side,
  // against the already-cached account list — zero extra Zoho calls. COD
  // has no clearing account by design (cash lands straight in a bank
  // account), so it silently falls back to the default deposit account
  // without a flag; anything else that fails to resolve gets flagged so
  // Finance knows it's about to post against the fallback, not the correct
  // gateway-specific account.
  const matches = useMemo<ResolvedMatch[]>(() => {
    if (!data) return [];
    return data.matches.map((m) => {
      const isCod = (m.sheetGateway ?? "").toLowerCase() === "cod";
      const resolved = resolveZohoAccountForSheetRow(m.sheetGateway, m.sheetTab, m.region, allAccounts);
      const account = resolved ?resolved: defaultAccount;
      const effectiveFlags = [...m.flags];
      if (!resolved && !isCod) effectiveFlags.push("account-unresolved");
      return {
        ...m,
        resolvedAccountId: account?.account_id ?? null,
        resolvedAccountName: account?.account_name ?? (isCod ? "On Track" : "No account resolved"),
        effectiveFlags,
      };
    });
  }, [data, allAccounts, defaultAccount]);

  // Pre-check every clean (unflagged) match the first time data arrives —
  // never re-seed on refetch, or a manual deselect would keep getting undone.
  if (data && !seededSelection) {
    const initial: RowSelectionState = {};
    for (const m of matches) if (m.effectiveFlags.length === 0) initial[`${m.invoiceId}`] = true;
    setRowSelection(initial);
    setSeededSelection(true);
  }

  const columns = useMemo<ColumnDef<ResolvedMatch>[]>(() => [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false}
          onCheckedChange={(v) => table.toggleAllRowsSelected(Boolean(v))}
          className="border-[#93C5FD] data-[state=checked]:bg-[#1D4ED8] data-[state=checked]:border-[#1D4ED8]"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(Boolean(v))}
          className="border-[#93C5FD] data-[state=checked]:bg-[#1D4ED8] data-[state=checked]:border-[#1D4ED8]"
        />
      ),
    },
    { accessorKey: "orderNumber", header: "Order #",
      cell: ({ row }) => <span className="font-mono text-[12.5px] text-[#0F172A]">{row.original.orderNumber}</span> },
    { accessorKey: "invoiceNumber", header: "Invoice",
      cell: ({ row }) => <span className="font-mono text-[12.5px] text-[#0F172A]">{row.original.invoiceNumber}</span> },
    { accessorKey: "customerName", header: "Customer",
      cell: ({ row }) => <span className="max-w-50 truncate text-[12.5px] text-[#0F172A]" title={row.original.customerName}>{row.original.customerName}</span> },
    {
      id: "account", header: "Sheet party → Zoho account",
      cell: ({ row }) => {
        const m = row.original;
        const unresolved = m.effectiveFlags.includes("account-unresolved");
        return (
          <div className="flex items-center gap-1.5 text-[12.5px]">
            <span className="text-[#64748B]">{m.sheetPartyRaw || "—"}</span>
            <span className="text-[#BFDBFE]">→</span>
            <span className={unresolved ? "font-medium text-[#B45309]" : "font-medium text-[#1D4ED8]"}>{m.resolvedAccountName}</span>
          </div>
        );
      },
    },
    { accessorKey: "paymentDate", header: "Payment date",
      cell: ({ row }) => <span className="text-[12.5px] tabular-nums text-[#0F172A]">{row.original.paymentDate ?? "—"}</span> },
    { accessorKey: "paymentMode", header: "Mode",
      cell: ({ row }) => <span className="text-[12.5px] text-[#64748B]">{row.original.paymentMode}</span> },
    { accessorKey: "balance", header: () => <span className="block text-right">Balance</span>,
      cell: ({ row }) => <span className="block text-right font-mono text-[12.5px] tabular-nums text-[#0F172A]">{aed(row.original.balance)}</span> },
    {
      id: "flags", header: "Flags",
      cell: ({ row }) => {
        const flags = row.original.effectiveFlags;
        if (flags.length === 0) {
          return <span className="inline-flex items-center gap-1 text-[11.5px] text-[#15803D]"><CheckCircle2 size={12} />Clean</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {flags.map((f,i) => (
              <Badge key={i} variant="outline" className={`text-[10.5px] font-normal ${
                f === "account-unresolved"
                  ? "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]"
                  : "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]"
              }`}>
                {f === "account-unresolved" && <ShieldAlert size={10} className="mr-1" />}
                {FLAG_LABEL[f]}
              </Badge>
            ))}
          </div>
        );
      },
    },
  ], []);

  const table = useReactTable({
    data: matches,
    columns,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.invoiceId,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
  });

  const selectedMatches = table.getSelectedRowModel().rows.map((r) => r.original);
  const selectedBalance = selectedMatches.reduce((s, m) => s + m.balance, 0);

  const openClose = () => {
    if (selectedMatches.length === 0) return toast.error("Select at least one match");
    if (selectedMatches.some((m) => !m.resolvedAccountId)) {
      return toast.error("No default Zoho account configured — set one in Reconciliation settings, or wait for it to load");
    }

    // /api/invoices/publish takes one date + payment mode + account per
    // call — group the selection so each call is internally consistent,
    // now including the resolved account (Tabby KSA and Tabby UAE must
    // never be posted in the same batch even if the date matches).
    const groups = new Map<string, CloseGroup>();
    for (const m of selectedMatches) {
      const date = m.paymentDate ?? new Date().toISOString().slice(0, 10);
      const key = `${date}__${m.paymentMode}__${m.resolvedAccountId}`;
      const g = groups.get(key) ?? { key, date, paymentMode: m.paymentMode, accountId: m.resolvedAccountId!, accountName: m.resolvedAccountName, invoiceIds: [] };
      g.invoiceIds.push(m.invoiceId);
      groups.set(key, g);
    }
    setClosing([...groups.values()]);
  };

  const onCloseDone = (ok: number, failed: number, skipped: number) => {
    const parts = [`${ok} recorded`];
    if (failed) parts.push(`${failed} failed`);
    if (skipped) parts.push(`${skipped} skipped`);
    (failed > 0 ? toast.warning : toast.success)(parts.join(" · "));
    setSeededSelection(false);
    setRowSelection({});
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#DBEAFE] bg-gradient-to-r from-[#EFF6FF] to-white p-3 shadow-sm">
        <span className="text-[12.5px] text-[#1E3A8A]">
          Payments sheet → unpaid Zoho invoices, {from} → {to}
        </span>
        <Button
          size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}
          className="ml-auto h-9 border-[#BFDBFE] text-[#1D4ED8] hover:bg-[#DBEAFE]"
        >
          {isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#991B1B]">{(error as Error).message}</div>
      )}

      {data && data.unmatchedSheetRows.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-[#FFFBEB] px-4 py-3 text-[12.5px] text-[#92400E]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {data.unmatchedSheetRows.length} sheet row(s) marked "Payment Received" have no matching unpaid invoice in this
            window — likely already closed, or the order # doesn't match. Not shown below.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12.5px] text-[#334155]">
        <span><b className="text-[#0F172A]">{matches.length}</b> matched</span>
        {selectedMatches.length > 0 && (
          <>
            <span className="text-[#BFDBFE]">·</span>
            <span className="text-[#1D4ED8]">
              <b>{selectedMatches.length}</b> selected · <b className="tabular-nums">AED {aed(selectedBalance)}</b>
            </span>
          </>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-[#DBEAFE] bg-white shadow-sm">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg,i) => (
              <TableRow key={i} className="border-[#DBEAFE] bg-[#F8FAFF] hover:bg-[#F8FAFF]">
                {hg.headers.map((h,i) => (
                  <TableHead key={i} className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B]">
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={columns.length} className="h-24 text-center text-[#64748B]"><Loader2 size={16} className="mx-auto animate-spin" /></TableCell></TableRow>
            ) : matches.length === 0 ? (
              <TableRow><TableCell colSpan={columns.length} className="h-24 text-center text-[#64748B]">No sheet-confirmed payments match an unpaid invoice in this window.</TableCell></TableRow>
            ) : (
              table.getRowModel().rows.map((row, i) => {
                const flagged = row.original.effectiveFlags.length > 0;
                return (
                  <motion.tr
                    key={i}
                    custom={i}
                    initial="hidden"
                    animate="visible"
                    variants={rowVariants}
                    className={`border-b border-[#DBEAFE] transition-colors ${flagged ? "border-l-4 border-l-[#F59E0B]" : ""} ${row.getIsSelected() ? "bg-[#EFF6FF]" : "hover:bg-[#F8FAFF]"}`}
                  >
                    {row.getVisibleCells().map((cell,j) => (
                      <TableCell key={j} className="py-2">{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </motion.tr>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {selectedMatches.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="sticky bottom-18 z-10 mx-auto flex max-w-5xl flex-wrap items-center gap-2 rounded-xl border border-[#1D4ED8] bg-gradient-to-r from-[#1E3A8A] to-[#1D4ED8] p-3 shadow-xl"
        >
          <span className="text-[13px] font-medium text-white">
            {selectedMatches.length} selected · <span className="tabular-nums">AED {aed(selectedBalance)}</span>
          </span>
          <Button onClick={openClose} className="ml-auto h-9 bg-white text-[#1D4ED8] hover:bg-[#EFF6FF]">
            <CheckCircle2 size={14} className="mr-1.5" />
            Close {selectedMatches.length}
          </Button>
        </motion.div>
      )}

      {closing && (
        <SheetMatchCloseDialog
          groups={closing}
          onClose={() => setClosing(null)}
          onDone={onCloseDone}
        />
      )}
    </div>
  );
}
