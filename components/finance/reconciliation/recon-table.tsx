"use client";

/* Dense reconciliation table: one row per bank credit, sortable, with the
 * bank → payout → orders chain compressed to a few columns and a trailing
 * actions cell (open detail, upload payout, download file, delete payout).
 * Clicking a row opens ReconDetailDialog with the full breakdown + every
 * action. Replaces the old stack of always-expanded ReconRow cards. */

import { useMemo, useState, useRef } from "react";
import {
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import {
  AlertTriangle, ArrowUpDown, BookCheck, Check, Clock, Download, Flag, HelpCircle,
  Loader2, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { gatewayColor } from "./colors";
import { ReconDetailDialog } from "./recon-detail-dialog";
import { aed2, isDownloadableSource, STATE_META, type ReconLine, type ReconPayload, type UploadSlotFor } from "./types";

const STATE_ICON = {
  SETTLED: Check, PAYOUT_VARIANCE: AlertTriangle, ORDERS_UNRESOLVED: HelpCircle, AWAITING_PAYOUT: Clock,
} as const;

const TONE_BG: Record<string, string> = {
  ok: "bg-[#F0F5EF] text-[#4B7A54]",
  bad: "bg-[#F9ECE7] text-[#A6472F]",
  warn: "bg-[#FBF2E6] text-[#B0742E]",
  info: "bg-[#E8F1F3] text-[#2E6B7A]",
  muted: "bg-[#F3EFE7] text-[#8A8175]",
};

function DeletePayoutButton({ line, refresh }: { line: ReconLine; refresh: () => void }) {
  const [deleting, setDeleting] = useState(false);
  if (!line.payout || line.confirmedBy) return null;

  const run = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/payouts/${encodeURIComponent(line.payout!.id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Delete failed");
      toast.success(`Payout ${line.payout!.id} deleted — credit reverted to Awaiting payout`);
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
          title="Delete payout"
          className="rounded-md border border-[#EAE3D6] bg-white p-1.5 text-[#A6472F] transition-colors hover:border-[#A6472F] hover:bg-[#F9ECE7] disabled:opacity-50"
        >
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this payout?</AlertDialogTitle>
          <AlertDialogDescription>
            Removes {line.payout.id} and its per-order breakdown. The bank credit reverts to
            &quot;Awaiting payout&quot; so you can re-upload the correct file. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={run} className="bg-[#A6472F] hover:bg-[#8E3A25]">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ReconTable({
  lines, allLines, isFounder, postings, onConfirm, refresh, uploadSlotFor,
}: {
  lines: ReconLine[];
  /** Every loaded credit, so an open modal survives its row moving to another
   *  tab or group (e.g. Awaiting → Settled right after a payout upload). */
  allLines?: ReconLine[];
  isFounder: boolean;
  postings: ReconPayload["zohoPostings"];
  onConfirm: (id: string) => void;
  refresh: () => void;
  uploadSlotFor: UploadSlotFor;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }]);
  // Keep only the id: the modal must show the line as it is NOW. Holding the
  // row object froze it at click time, so after uploading a payout from the
  // modal the orders didn't appear until the page was reloaded.
  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const lastOpen = useRef<ReconLine | null>(null);
  const liveOpen = openLineId ? (allLines ?? lines).find((l) => l.id === openLineId) ?? null : null;
  if (liveOpen) lastOpen.current = liveOpen;
  const openLine = openLineId ? liveOpen ?? lastOpen.current : null;

  const columns = useMemo<ColumnDef<ReconLine>[]>(() => [
    {
      id: "date",
      accessorFn: (r) => r.date ?? "",
      header: "Date",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-[12.5px] tabular-nums text-[#1F1B16]">
          {row.original.date?.slice(0, 10) ?? "—"}
        </span>
      ),
    },
    {
      id: "provider",
      accessorFn: (r) => r.provider,
      header: "Gateway",
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium text-[#1F1B16]">
          <i className="h-2 w-2 rounded-full" style={{ background: gatewayColor(row.original.provider) }} />
          {row.original.provider}
        </span>
      ),
    },
    {
      id: "reference",
      accessorFn: (r) => r.reference,
      header: "Bank ref",
      cell: ({ row }) => (
        <span className="font-mono text-[11.5px] text-[#8A8175]">
          {row.original.reference || row.original.id.slice(0, 10)}
        </span>
      ),
    },
    {
      id: "bankAmount",
      accessorFn: (r) => r.bankAmount,
      header: () => <span className="block text-right">Bank credit</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-[12.5px] tabular-nums text-[#1F1B16]">
          {aed2(row.original.bankAmount)}
        </span>
      ),
    },
    {
      id: "payout",
      accessorFn: (r) => r.payout?.net ?? -1,
      header: () => <span className="block text-right">Payout net</span>,
      cell: ({ row }) => {
        const p = row.original.payout;
        return p ? (
          <span className="block text-right font-mono text-[12.5px] tabular-nums text-[#1F1B16]">{aed2(p.net)}</span>
        ) : (
          <span className="block text-right text-[11.5px] text-[#B0742E]">No file</span>
        );
      },
    },
    {
      id: "variance",
      accessorFn: (r) => Math.abs(r.variance),
      header: () => <span className="block text-right">Variance</span>,
      cell: ({ row }) => {
        const v = row.original.variance;
        return (
          <span
            className="block text-right font-mono text-[12.5px] tabular-nums"
            style={{ color: Math.abs(v) > 1 ? "#A6472F" : "#8A8175" }}
          >
            {aed2(v)}
          </span>
        );
      },
    },
    {
      id: "orders",
      accessorFn: (r) => r.resolvedOrders.length,
      header: () => <span className="block text-right">Orders</span>,
      cell: ({ row }) => {
        const r = row.original;
        if (r.unresolvedRefs.length > 0) {
          return <span className="block text-right text-[12px] font-medium text-[#A6472F]">{r.unresolvedRefs.length} missing</span>;
        }
        return <span className="block text-right text-[12px] tabular-nums text-[#1F1B16]">{r.resolvedOrders.length || "—"}</span>;
      },
    },
    {
      id: "state",
      accessorFn: (r) => r.state,
      header: "Status",
      cell: ({ row }) => {
        const r = row.original;
        const meta = STATE_META[r.state];
        const Icon = STATE_ICON[r.state];
        const posting = postings[r.id];
        // Confirmed with no payout file is not a settled row — it was confirmed
        // on trust before the report existed. Say so, rather than showing a
        // clean "Confirmed" that implies evidence nobody has seen.
        const proofMissing = Boolean(r.confirmedBy) && !r.payout;
        return (
          <div className="flex flex-wrap items-center gap-1">
            <span
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${proofMissing ? TONE_BG.warn : r.forceBook && r.confirmedBy ? TONE_BG.ok : TONE_BG[meta.tone]}`}
              title={proofMissing ? "Confirmed without a payout file — upload the settlement report to complete it" : r.forceBook ? `Force-booked: ${r.forceBook.note}` : undefined}
            >
              <Icon size={11} />
              {proofMissing ? "Confirmed · proof missing" : r.forceBook && r.confirmedBy ? `Force-booked · ${aed2(Math.abs(r.variance))} gap` : r.confirmedBy ? "Confirmed" : meta.label}
            </span>
            {posting && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#FBF3E6] px-2 py-0.5 text-[11px] font-medium text-[#6F5325]" title="Recorded in Zoho">
                <BookCheck size={11} />
              </span>
            )}
            {r.reviewFlag && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#FBF3E6] px-2 py-0.5 text-[11px] font-medium text-[#6F5325]" title="Flagged for review">
                <Flag size={11} />
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: () => <span className="block text-right">Actions</span>,
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {/* Only offer the download when there IS a document. A payout
                synced from a gateway API has source="stripe-api", not a
                filename, and the link 404'd for every one of them. */}
            {isDownloadableSource(r.payout?.source) && (
              <a
                href={`/api/files/by-name?filename=${encodeURIComponent(r.payout!.source!)}&provider=${encodeURIComponent(r.provider)}`}
                title={`Download ${r.payout!.source}`}
                className="rounded-md border border-[#EAE3D6] bg-white p-1.5 text-[#1F1B16] transition-colors hover:border-[#B08343] hover:text-[#6F5325]"
              >
                <Download size={13} />
              </a>
            )}
            {r.payout && !isDownloadableSource(r.payout.source) && (
              <span
                title="Synced from the gateway API — there is no file to download"
                className="rounded-md border border-dashed border-[#EAE3D6] px-1.5 py-1 text-[10px] text-[#8A8175]"
              >
                API
              </span>
            )}
            {/* Gated on the credit having NO payout file, never on it being
                unconfirmed. A row confirmed while still AWAITING_PAYOUT has no
                proof at all, and hiding the uploader there left four credits
                permanently stuck — confirmed, fileless, and unrepairable. */}
            {!r.payout && r.provider !== "Unclassified" && (
              <span title="Upload payout file" className="[&_button]:!h-auto [&_button]:!rounded-md [&_button]:!border [&_button]:!border-[#EAE3D6] [&_button]:!bg-white [&_button]:!p-1.5">
                {uploadSlotFor(r.provider, r.id)}
              </span>
            )}
            <DeletePayoutButton line={r} refresh={refresh} />
          </div>
        );
      },
    },
  ], [postings, refresh, uploadSlotFor]);

  const table = useReactTable({
    data: lines,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-[#EAE3D6] bg-white shadow-sm">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="border-[#EAE3D6] bg-[#FBF8F1] hover:bg-[#FBF8F1]">
                {hg.headers.map((h) => (
                  <TableHead
                    key={h.id}
                    onClick={h.column.getCanSort() ? h.column.getToggleSortingHandler() : undefined}
                    className={`text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175] ${h.column.getCanSort() ? "cursor-pointer select-none" : ""}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getCanSort() && (
                        <ArrowUpDown size={10} className={h.column.getIsSorted() ? "text-[#B08343]" : "text-[#D6CCBA]"} />
                      )}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => setOpenLineId(row.original.id)}
                className={`cursor-pointer border-b border-[#EAE3D6] transition-colors hover:bg-[#FBF8F1] ${row.original.reviewFlag ? "border-l-2 border-l-[#B08343]" : ""}`}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {openLine && (
        <ReconDetailDialog
          line={openLine}
          isFounder={isFounder}
          posting={postings[openLine.id]}
          onConfirm={onConfirm}
          refresh={refresh}
          uploadSlot={uploadSlotFor(openLine.provider, openLine.id, "dropzone")}
          onClose={() => setOpenLineId(null)}
        />
      )}
    </>
  );
}
