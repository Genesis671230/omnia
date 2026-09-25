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
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Download, FilterX, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { gatewayColor } from "./colors";
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
          className="rounded-md p-1.5 text-[#5E564B] transition-colors hover:bg-[#F3EFE7] hover:text-[#1F1B16]"
        >
          <Download size={14} />
        </a>
      )}
      {r.payout && !isDownloadableSource(r.payout.source) && (
        <span title="Synced from the gateway API, no file" className="rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[#8A8175] ring-1 ring-inset ring-[#EAE3D6]">
          API
        </span>
      )}
      {!r.payout && r.provider !== "Unclassified" && (
        <span title="Upload payout file" className="[&_button]:!h-auto [&_button]:!rounded-md [&_button]:!border-0 [&_button]:!bg-transparent [&_button]:!p-1.5 [&_button:hover]:!bg-[#F3EFE7]">
          {uploadSlotFor(r.provider, r.id)}
        </span>
      )}
      <DeletePayoutButton line={r} refresh={refresh} />
      <ChevronRight size={15} className="ml-0.5 text-[#C9BFAE]" aria-hidden />
    </div>
  );
}

function Gateway({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium text-[#1F1B16]">
      <i className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white" style={{ background: gatewayColor(name) }} aria-hidden />
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
  if (!hasPayout) return <span className="text-[#C9BFAE]">—</span>;
  const big = Math.abs(v) > 1;
  return <span className={`font-mono tabular-nums ${big ? "text-[#9B3A24]" : "text-[#8A8175]"}`}>{Math.abs(v) < 0.005 ? "0.00" : aed2(v)}</span>;
}

export function ReconGrid({
  lines, loading, postings, refresh, uploadSlotFor, onOpen, openId, filterSummary, onClearFilters, hasAnyData,
}: {
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
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-[#1F1B16]">{fmtDate(row.original.date)}</span> },
    { id: "provider", accessorFn: (r) => r.provider, header: "Gateway", cell: ({ row }) => <Gateway name={row.original.provider} /> },
    { id: "reference", accessorFn: (r) => r.reference, header: "Bank ref",
      cell: ({ row }) => <span className="font-mono text-[12px] text-[#6B6358]">{row.original.reference || row.original.id.slice(0, 10)}</span> },
    { id: "bankAmount", accessorFn: (r) => r.bankAmount, header: "Bank credit", meta: { right: true },
      cell: ({ row }) => <span className="font-mono font-medium tabular-nums text-[#1F1B16]">{aed2(row.original.bankAmount)}</span> },
    { id: "payout", accessorFn: (r) => r.payout?.net ?? -Infinity, header: "Payout net", meta: { right: true },
      cell: ({ row }) => row.original.payout
        ? <span className="font-mono tabular-nums text-[#1F1B16]">{aed2(row.original.payout.net)}</span>
        : <span className="text-[12px] text-[#8A8175]">No file</span> },
    { id: "variance", accessorFn: (r) => (r.payout ? Math.abs(r.variance) : -1), header: "Variance", meta: { right: true },
      cell: ({ row }) => <Variance v={row.original.variance} hasPayout={!!row.original.payout} /> },
    { id: "orders", accessorFn: (r) => r.resolvedOrders.length + r.unresolvedRefs.length, header: "Orders", meta: { right: true },
      cell: ({ row }) => <Orders r={row.original} /> },
    { id: "status", accessorFn: (r) => `${r.state}${r.reviewFlag ? "1" : "0"}`, header: "Match status",
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
  const rows = table.getRowModel().rows;

  if (!loading && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#DCD3C2] bg-white px-6 py-14 text-center">
        <FilterX size={22} className="text-[#B08343]" aria-hidden />
        <p className="text-[14px] font-medium text-[#1F1B16]">
          {hasAnyData ? "No credits match these filters" : "No bank credits yet"}
        </p>
        <p className="max-w-md text-[12.5px] leading-relaxed text-[#8A8175]">
          {hasAnyData ? filterSummary : "Upload a bank statement. Each credit then waits for the payout file that explains it."}
        </p>
        {hasAnyData && (
          <button onClick={onClearFilters} className="mt-1 rounded-full bg-[#1F1B16] px-4 py-1.5 text-[12.5px] font-medium text-[#FBF8F1] hover:bg-[#35302A]">
            Clear filters
          </button>
        )}
      </div>
    );
  }

  const right = (c: { columnDef: ColumnDef<ReconLine> }) => (c.columnDef.meta as { right?: boolean } | undefined)?.right;

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-auto rounded-2xl border border-[#EAE3D6] bg-white shadow-[0_1px_2px_rgba(31,27,22,0.04)] md:block md:max-h-[calc(100vh-300px)] md:min-h-[460px]">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
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
                      className={`sticky top-0 z-10 border-b border-[#EAE3D6] bg-[#FBF8F1]/95 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8A8175] backdrop-blur ${right(h.column) ? "text-right" : "text-left"}`}
                    >
                      {can ? (
                        <button onClick={h.column.getToggleSortingHandler()} className={`inline-flex items-center gap-1 hover:text-[#1F1B16] ${right(h.column) ? "flex-row-reverse" : ""}`}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === "asc" ? <ArrowUp size={11} className="text-[#B08343]" /> : sorted === "desc" ? <ArrowDown size={11} className="text-[#B08343]" /> : <ArrowUpDown size={11} className="text-[#D6CCBA]" />}
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
                      <td key={j} className="border-b border-[#F3EFE7] px-4 py-3.5">
                        <div className="h-3 animate-pulse rounded bg-[#EFE9DD]" style={{ width: `${45 + ((i * 7 + j * 13) % 45)}%` }} />
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
                    className={`group cursor-pointer outline-none transition-colors hover:bg-[#FBF8F1] focus-visible:bg-[#FBF3E6] ${openId === row.original.id ? "bg-[#FBF3E6]" : ""}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={`border-b border-[#F3EFE7] px-4 py-3 align-middle ${right(cell.column) ? "text-right" : "text-left"}`}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2.5 md:hidden">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="space-y-2.5 rounded-2xl border border-[#EAE3D6] bg-white p-4">
                <div className="h-3 w-1/2 animate-pulse rounded bg-[#EFE9DD]" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-[#EFE9DD]" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-[#EFE9DD]" />
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
                    className="rounded-2xl border border-[#EAE3D6] bg-white p-4 text-[13px] shadow-[0_1px_2px_rgba(31,27,22,0.04)] active:bg-[#FBF8F1]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Gateway name={r.provider} />
                        <div className="mt-0.5 truncate font-mono text-[11.5px] text-[#8A8175]">{fmtDate(r.date)} · {r.reference || r.id.slice(0, 10)}</div>
                      </div>
                      <span className="font-mono text-[15px] font-semibold tabular-nums">{aed2(r.bankAmount)}</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                      <div><dt className="text-[10.5px] uppercase tracking-wide text-[#8A8175]">Payout net</dt><dd className="font-mono tabular-nums">{r.payout ? aed2(r.payout.net) : "No file"}</dd></div>
                      <div><dt className="text-[10.5px] uppercase tracking-wide text-[#8A8175]">Variance</dt><dd><Variance v={r.variance} hasPayout={!!r.payout} /></dd></div>
                      <div><dt className="text-[10.5px] uppercase tracking-wide text-[#8A8175]">Orders</dt><dd><Orders r={r} /></dd></div>
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
    </>
  );
}
