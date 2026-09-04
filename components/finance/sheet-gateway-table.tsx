"use client";

/* Gateway breakdown table for the payments-sheet insights panel — "prove
   this many orders from that gateway, and cancelled/returned this much."
   Country-aware gateway labels (Tabby KSA / Tabby KWD / Tabby UAE, etc —
   see lib/finance/payments-sheet.ts for the currency->region mapping) are
   computed once server-side and re-aggregated here client-side per the
   active date range, using the identical pure function the API used
   (lib/finance/payments-sheet-insights.ts), so the numbers can't drift. */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  type ColumnDef, type SortingState,
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { GatewayBreakdownRow } from "@/lib/finance/payments-sheet-insights";

const AED = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const aed = (n: number) => AED.format(n);

function SortHeader({ label, sorted, align = "left" }: { label: string; sorted: false | "asc" | "desc"; align?: "left" | "right" }) {
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <div className={`flex cursor-pointer select-none items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
      {align === "right" && <Icon size={11} className={sorted ? "text-[#2563EB]" : "text-[#BFDBFE]"} />}
      <span>{label}</span>
      {align === "left" && <Icon size={11} className={sorted ? "text-[#2563EB]" : "text-[#BFDBFE]"} />}
    </div>
  );
}

export function SheetGatewayTable({ rows }: { rows: GatewayBreakdownRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "totalOrders", desc: true }]);

  const maxOrders = useMemo(() => Math.max(1, ...rows.map((r) => r.totalOrders)), [rows]);

  const totals = useMemo(() => rows.reduce(
    (acc, r) => ({
      totalOrders: acc.totalOrders + r.totalOrders,
      receivedCount: acc.receivedCount + r.received.count,
      receivedAed: acc.receivedAed + r.received.amountAed,
      pending: acc.pending + r.pending.count,
      exchange: acc.exchange + r.exchange.count,
      cancelledCount: acc.cancelledCount + r.cancelled.count,
      cancelledAed: acc.cancelledAed + r.cancelled.amountAed,
    }),
    { totalOrders: 0, receivedCount: 0, receivedAed: 0, pending: 0, exchange: 0, cancelledCount: 0, cancelledAed: 0 },
  ), [rows]);

  const columns = useMemo<ColumnDef<GatewayBreakdownRow>[]>(() => [
    {
      accessorKey: "gatewayLabel", header: "Gateway",
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${row.original.gatewayLabel === "Unresolved" ? "bg-[#CBD5E1]" : "bg-[#2563EB]"}`} />
          <span className={`text-[12.5px] font-medium ${row.original.gatewayLabel === "Unresolved" ? "text-[#94A3B8]" : "text-[#0F172A]"}`}>
            {row.original.gatewayLabel}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "totalOrders", header: ({ column }) => <SortHeader label="Orders" sorted={column.getIsSorted()} align="right" />,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#EFF6FF]">
            <div className="h-full rounded-full bg-gradient-to-r from-[#3B82F6] to-[#1D4ED8]" style={{ width: `${(row.original.totalOrders / maxOrders) * 100}%` }} />
          </div>
          <span className="w-8 text-right font-mono text-[12.5px] tabular-nums text-[#0F172A]">{row.original.totalOrders}</span>
        </div>
      ),
    },
    {
      id: "received", accessorFn: (r) => r.received.count, header: ({ column }) => <SortHeader label="Received" sorted={column.getIsSorted()} align="right" />,
      cell: ({ row }) => (
        <div className="text-right">
          <div className="font-mono text-[12.5px] tabular-nums text-[#15803D]">{row.original.received.count}</div>
          <div className="font-mono text-[10.5px] tabular-nums text-[#94A3B8]">AED {aed(row.original.received.amountAed)}</div>
        </div>
      ),
    },
    {
      id: "pending", accessorFn: (r) => r.pending.count, header: ({ column }) => <SortHeader label="Pending" sorted={column.getIsSorted()} align="right" />,
      cell: ({ row }) => <span className="block text-right font-mono text-[12.5px] tabular-nums text-[#B45309]">{row.original.pending.count}</span>,
    },
    {
      id: "exchange", accessorFn: (r) => r.exchange.count, header: ({ column }) => <SortHeader label="Exchange" sorted={column.getIsSorted()} align="right" />,
      cell: ({ row }) => <span className="block text-right font-mono text-[12.5px] tabular-nums text-[#0F172A]">{row.original.exchange.count}</span>,
    },
    {
      id: "cancelled", accessorFn: (r) => r.cancelled.count, header: ({ column }) => <SortHeader label="Cancelled / returned" sorted={column.getIsSorted()} align="right" />,
      cell: ({ row }) => (
        <div className="text-right">
          <div className="font-mono text-[12.5px] tabular-nums text-[#B91C1C]">{row.original.cancelled.count}</div>
          {row.original.cancelled.amountAed > 0 && (
            <div className="font-mono text-[10.5px] tabular-nums text-[#94A3B8]">AED {aed(row.original.cancelled.amountAed)}</div>
          )}
        </div>
      ),
    },
  ], [maxOrders]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-[#DBEAFE] bg-white shadow-sm">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="border-[#DBEAFE] bg-[#F8FAFF] hover:bg-[#F8FAFF]">
              {hg.headers.map((h) => (
                <TableHead
                  key={h.id}
                  onClick={h.column.getToggleSortingHandler()}
                  className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B]"
                >
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={columns.length} className="h-20 text-center text-[13px] text-[#94A3B8]">No orders in this range.</TableCell></TableRow>
          ) : (
            table.getRowModel().rows.map((row, i) => (
              <motion.tr
                key={row.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i, 15) * 0.02, duration: 0.2 }}
                className="border-b border-[#EFF6FF] hover:bg-[#F8FAFF]"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-2.5">{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </motion.tr>
            ))
          )}
        </TableBody>
        {rows.length > 0 && (
          <tfoot>
            <TableRow className="border-t-2 border-[#DBEAFE] bg-[#F8FAFF] hover:bg-[#F8FAFF]">
              <TableCell className="py-2.5 text-[12.5px] font-semibold text-[#0F172A]">Total</TableCell>
              <TableCell className="py-2.5 text-right font-mono text-[12.5px] font-semibold tabular-nums text-[#0F172A]">{totals.totalOrders}</TableCell>
              <TableCell className="py-2.5 text-right">
                <div className="font-mono text-[12.5px] font-semibold tabular-nums text-[#15803D]">{totals.receivedCount}</div>
                <div className="font-mono text-[10.5px] tabular-nums text-[#94A3B8]">AED {aed(totals.receivedAed)}</div>
              </TableCell>
              <TableCell className="py-2.5 text-right font-mono text-[12.5px] font-semibold tabular-nums text-[#B45309]">{totals.pending}</TableCell>
              <TableCell className="py-2.5 text-right font-mono text-[12.5px] font-semibold tabular-nums text-[#0F172A]">{totals.exchange}</TableCell>
              <TableCell className="py-2.5 text-right">
                <div className="font-mono text-[12.5px] font-semibold tabular-nums text-[#B91C1C]">{totals.cancelledCount}</div>
                {totals.cancelledAed > 0 && <div className="font-mono text-[10.5px] tabular-nums text-[#94A3B8]">AED {aed(totals.cancelledAed)}</div>}
              </TableCell>
            </TableRow>
          </tfoot>
        )}
      </Table>
    </div>
  );
}
