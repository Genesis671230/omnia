"use client";

/* One table for every filtered credit (no per-gateway accordions).
 * Desktop: sortable table with a sticky header inside its own scroll box, so
 * the scroll position survives opening and closing the detail drawer.
 * Under 768px: the same rows as stacked cards. */

import { useMemo, useState } from "react";
import {
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Download, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { GatewayLogo } from "./gateway-logo";
import { MatchStatusBadge, RowTags } from "./recon-status-badge";
import { aed2, isDownloadableSource, type ReconLine, type ReconPayload, type UploadSlotFor } from "./types";

const fmtDate = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function DeletePayoutButton({ line, refresh }: { line: ReconLine; refresh: () => void }) {
  const [deleting, setDeleting] = useState(false);
  if (!line.payout || line.confirmedBy) return null;
  const run = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/payouts/${encodeURIComponent(line.payout!.id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Delete failed");
      toast.success(`Payout ${line.payout!.id} deleted. Credit is back to Awaiting payout.`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          disabled={deleting}
          aria-label="Delete payout file"
          title="Delete payout file"
          className="rounded-md p-1.5 text-[#9B3A24] transition-colors hover:bg-[#FBECE8] disabled:opacity-50"
        >
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()} className="bg-white">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this payout?</AlertDialogTitle>
          <AlertDialogDescription>
            Removes {line.payout.id} and its per-order breakdown. The bank credit goes back to Awaiting payout so the
            correct file can be uploaded. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={run} className="bg-[#9B3A24] hover:bg-[#82301D]">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RowActions({ r, refresh, uploadSlotFor }: { r: ReconLine; refresh: () => void; uploadSlotFor: UploadSlotFor }) {
  return (
    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
      {isDownloadableSource(r.payout?.source) && (
        <a
          href={`/api/files/by-name?filename=${encodeURIComponent(r.payout!.source!)}&provider=${encodeURIComponent(r.provider)}`}
          title={`Download ${r.payout!.source}`}
          aria-label="Download payout file"
          className="rounded-md p-1.5 text-[#5E564B] transition-colors hover:bg-[#EEF2FA] hover:text-[#0F1B3D]"
        >
          <Download size={14} />
        </a>
      )}
      {r.payout && !isDownloadableSource(r.payout.source) && (
        <span title="Synced from the gateway API, no file" className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[#6B7385] ring-1 ring-inset ring-[#E3E7F0]">
          API
        </span>
      )}
      <DeletePayoutButton line={r} refresh={refresh} />
      <ChevronRight size={15} className="ml-0.5 text-[#C9CFDA]" aria-hidden />
    </div>
  );
}

function Gateway({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap font-medium text-[#14131C]">
      <GatewayLogo name={name} size={20} />
      {name}
    </span>
  );
}

function Orders({ r }: { r: ReconLine }) {
  if (r.unresolvedRefs.length > 0) {
    return <span className="font-medium text-[#9B3A24]">{r.resolvedOrders.length} + {r.unresolvedRefs.length} unmatched</span>;
  }
  return <span className="tabular-nums">{r.resolvedOrders.length || "—"}</span>;
}

function Variance({ v, hasPayout }: { v: number; hasPayout: boolean }) {
  if (!hasPayout) return <span className="text-[#C8D2E6]">—</span>;
  const big = Math.abs(v) > 1;
  return <span className={`font-mono tabular-nums ${big ? "text-[#9B3A24]" : "text-[#5E6B85]"}`}>{Math.abs(v) < 0.005 ? "0.00" : aed2(v)}</span>;
}

export function ReconGrid({
  lines, loading, postings, refresh, uploadSlotFor, onOpen, openId, filterSummary, onClearFilters, hasAnyData, toolbar, above,
}: {
  /** Filters, rendered as the card's top bar so the table and its controls read as one. */
  toolbar?: React.ReactNode;
  /** Optional panel between the toolbar and the rows (unmatched payout files). */
  above?: React.ReactNode;
  lines: ReconLine[];
  loading: boolean;
  postings: ReconPayload["zohoPostings"];
  refresh: () => void;
  uploadSlotFor: UploadSlotFor;
  onOpen: (id: string) => void;
  openId: string | null;
  filterSummary: string;
  onClearFilters: () => void;
  hasAnyData: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }]);

  const columns = useMemo<ColumnDef<ReconLine>[]>(() => [
    { id: "date", accessorFn: (r) => r.date ?? "", header: "Date",
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-[#0F1B3D]">{fmtDate(row.original.date)}</span> },
    { id: "provider", accessorFn: (r) => r.provider, header: "Gateway",
      cell: ({ row }) => (
        <div className="min-w-0">
          <Gateway name={row.original.provider} />
          <div className="mt-0.5 pl-[58px] font-mono text-[11px] text-[#9AA1B0]">{row.original.reference || row.original.id.slice(0, 10)}</div>
        </div>
      ) },
    { id: "bankAmount", accessorFn: (r) => r.bankAmount, header: "In bank", meta: { right: true },
      cell: ({ row }) => <span className="font-mono font-medium tabular-nums text-[#0F1B3D]">{aed2(row.original.bankAmount)}</span> },
    { id: "payout", accessorFn: (r) => r.payout?.net ?? -Infinity, header: "Payout net", meta: { right: true },
      cell: ({ row }) => row.original.payout
        ? <span className="font-mono tabular-nums text-[#0F1B3D]">{aed2(row.original.payout.net)}</span>
        : row.original.provider !== "Unclassified"
          ? <span onClick={(e) => e.stopPropagation()} title="No payout file for this bank credit yet — upload it to reconcile" className="inline-flex [&_button]:!h-7 [&_button]:!rounded-[6px] [&_button]:!border [&_button]:!border-[#D9DEE8] [&_button]:!bg-white [&_button]:!px-2.5 [&_button]:!text-[12px] [&_button]:!font-medium [&_button]:!text-[#14131C] [&_button:hover]:!border-[#0B1533] [&_svg]:!mr-1 [&_svg]:!h-3 [&_svg]:!w-3">{uploadSlotFor(row.original.provider, row.original.id)}</span>
          : <span className="text-[12px] text-[#5E6B85]">No file</span> },
    { id: "orders", accessorFn: (r) => r.resolvedOrders.length + r.unresolvedRefs.length, header: "Orders", meta: { right: true },
      cell: ({ row }) => <Orders r={row.original} /> },
    { id: "status", accessorFn: (r) => `${r.state}${r.reviewFlag ? "1" : "0"}`, header: "Status",
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          <MatchStatusBadge line={row.original} />
          <RowTags line={row.original} posted={!!postings[row.original.id]} />
        </div>
      ) },
    { id: "actions", header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { right: true },
      cell: ({ row }) => <RowActions r={row.original} refresh={refresh} uploadSlotFor={uploadSlotFor} /> },
  ], [postings, refresh, uploadSlotFor]);

  const table = useReactTable({
    data: lines, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  });
  // Render a page at a time: 400 rows of badges and upload slots is what made
  // the page feel slow, not the API.
  const [limit, setLimit] = useState(60);
  const allRows = table.getRowModel().rows;
  const rows = allRows.slice(0, limit);

  const card = (children: React.ReactNode) => (
    <section className="rounded-[8px] border border-[#E3E7F0] bg-white">
      {toolbar}
      {above && <div className="border-b border-[#EEF1F5] px-4 py-3 [&>div]:mb-0">{above}</div>}
      {children}
    </section>
  );

  if (!loading && allRows.length === 0) {
    return card(
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        
        <p className="text-[14px] font-medium text-[#14131C]">
          {hasAnyData ? "No credits match these filters" : "No bank credits yet"}
        </p>
        <p className="max-w-md text-[12.5px] leading-relaxed text-[#5E6B85]">
          {hasAnyData ? filterSummary : "Upload a bank statement. Each credit then waits for the payout file that explains it."}
        </p>
        {hasAnyData && (
          <button onClick={onClearFilters} className="mt-1 h-8 rounded-[6px] bg-[#0B1533] px-3 text-[12.5px] font-medium text-white hover:bg-[#1A2647]">
            Clear filters
          </button>
        )}
      </div>,
    );
  }

  const right = (c: { columnDef: ColumnDef<ReconLine> }) => (c.columnDef.meta as { right?: boolean } | undefined)?.right;

  return card(
    <>
      {/* Desktop table: the page is the only scroll; the header sticks to the top of the window */}
      <div className="hidden md:block">
        <table className="w-full border-separate border-spacing-0 text-[13.5px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const can = h.column.getCanSort();
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                      className={`sticky top-0 z-10 border-b border-[#E3E7F0] bg-[#F9FAFB] px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[#6B7385] ${right(h.column) ? "text-right" : "text-left"}`}
                    >
                      {can ? (
                        <button onClick={h.column.getToggleSortingHandler()} className={`inline-flex items-center gap-1 hover:text-[#14131C] ${right(h.column) ? "flex-row-reverse" : ""}`}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === "asc" ? <ArrowUp size={11} className="text-[#0B1533]" /> : sorted === "desc" ? <ArrowDown size={11} className="text-[#0B1533]" /> : <ArrowUpDown size={11} className="text-[#C9CFDA]" />}
                        </button>
                      ) : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    {columns.map((_, j) => (
                      <td key={j} className="border-b border-[#EEF1F5] px-4 py-3.5">
                        <div className="h-3 animate-pulse rounded bg-[#E9EEF8]" style={{ width: `${45 + ((i * 7 + j * 13) % 45)}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onOpen(row.original.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(row.original.id); } }}
                    tabIndex={0}
                    aria-selected={openId === row.original.id}
                    className={`group cursor-pointer outline-none transition-colors hover:bg-[#F9FAFB] focus-visible:bg-[#F1F3F7] ${openId === row.original.id ? "bg-[#F1F3F7]" : ""}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={`border-b border-[#EEF1F5] px-4 py-3 align-middle ${right(cell.column) ? "text-right" : "text-left"}`}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
        {!loading && allRows.length > rows.length && (
          <div className="flex justify-center py-3">
            <button onClick={() => setLimit((n) => n + 100)} className="h-8 rounded-[6px] border border-[#D9DEE8] bg-white px-3 text-[12.5px] font-medium text-[#14131C] hover:border-[#0B1533]">
              Show {Math.min(100, allRows.length - rows.length)} more · {allRows.length - rows.length} hidden
            </button>
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2.5 bg-[#F3F6FC] p-2.5 md:hidden">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="space-y-2.5 rounded-2xl border border-[#D8E1F1] bg-white p-4">
                <div className="h-3 w-1/2 animate-pulse rounded bg-[#E9EEF8]" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-[#E9EEF8]" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-[#E9EEF8]" />
              </li>
            ))
          : rows.map((row) => {
              const r = row.original;
              return (
                <li key={row.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(r.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") onOpen(r.id); }}
                    className="rounded-2xl border border-[#D8E1F1] bg-white p-4 text-[13px] shadow-[0_1px_2px_rgba(15,27,61,0.04)] active:bg-[#F3F6FC]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Gateway name={r.provider} />
                        <div className="mt-0.5 truncate font-mono text-[11.5px] text-[#5E6B85]">{fmtDate(r.date)} · {r.reference || r.id.slice(0, 10)}</div>
                      </div>
                      <span className="font-mono text-[15px] font-semibold tabular-nums">{aed2(r.bankAmount)}</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                      <div><dt className="text-[10.5px] uppercase tracking-wide text-[#5E6B85]">Payout net</dt><dd className="font-mono tabular-nums">{r.payout ? aed2(r.payout.net) : "No file"}</dd></div>
                      <div><dt className="text-[10.5px] uppercase tracking-wide text-[#5E6B85]">Variance</dt><dd><Variance v={r.variance} hasPayout={!!r.payout} /></dd></div>
                      <div><dt className="text-[10.5px] uppercase tracking-wide text-[#5E6B85]">Orders</dt><dd><Orders r={r} /></dd></div>
                    </dl>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1"><MatchStatusBadge line={r} /><RowTags line={r} posted={!!postings[r.id]} /></div>
                      <RowActions r={r} refresh={refresh} uploadSlotFor={uploadSlotFor} />
                    </div>
                  </div>
                </li>
              );
            })}
      </ul>
    </>,
  );
}
