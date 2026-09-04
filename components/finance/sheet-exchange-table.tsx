"use client";

/* Exchange orders pulled from the payments sheet (see the "Part"/"Type of
   Sale" column detection in lib/finance/payments-sheet.ts), expandable per
   row to show the SKUs on that order — joined from Supabase, not Zoho, so
   this loads even when Zoho is rate limited. */

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type ColumnDef, type ExpandedState,
  flexRender, getCoreRowModel, getExpandedRowModel, useReactTable,
} from "@tanstack/react-table";
import { ChevronRight, Loader2, PackageSearch } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const AED = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const aed = (n: number) => AED.format(n);

type LineItem = { sku: string; title: string; qty: number; totalAed: number };
type ExchangeRow = {
  tab: "smsa" | "local";
  rowNumber: number;
  orderNumber: string;
  date: string | null;
  saleType: string;
  gatewayLabel: string | null;
  lineItems: LineItem[] | null;
};

async function fetchExchanges(spreadsheetId: string, from: string, to: string): Promise<ExchangeRow[]> {
  const params = new URLSearchParams();
  if (spreadsheetId) params.set("spreadsheetId", spreadsheetId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const res = await fetch(`/api/invoices/sheet-exchanges?${params}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.exchanges;
}

export function SheetExchangeTable({ spreadsheetId, from, to }: { spreadsheetId: string; from: string; to: string }) {
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ["sheet-exchanges", spreadsheetId, from, to],
    queryFn: () => fetchExchanges(spreadsheetId, from, to),
  });

  const exchanges = data ?? [];

  const columns = useMemo<ColumnDef<ExchangeRow>[]>(() => [
    {
      id: "expander",
      header: () => null,
      cell: ({ row }) => {
        const count = row.original.lineItems?.length ?? 0;
        if (count === 0) return null;
        return (
          <button onClick={row.getToggleExpandedHandler()} className="flex h-6 w-6 items-center justify-center rounded text-[#64748B] hover:bg-[#EFF6FF]">
            <ChevronRight size={13} className={`transition-transform ${row.getIsExpanded() ? "rotate-90" : ""}`} />
          </button>
        );
      },
    },
    { accessorKey: "orderNumber", header: "Order #",
      cell: ({ row }) => <span className="font-mono text-[12.5px] text-[#0F172A]">{row.original.orderNumber}</span> },
    { accessorKey: "date", header: "Date",
      cell: ({ row }) => <span className="text-[12.5px] tabular-nums text-[#0F172A]">{row.original.date ?? "—"}</span> },
    { accessorKey: "tab", header: "Tab",
      cell: ({ row }) => <Badge variant="outline" className="border-[#BFDBFE] font-normal text-[10.5px] text-[#1D4ED8]">{row.original.tab === "smsa" ? "SMSA Orders" : "Local orders"}</Badge> },
    { accessorKey: "saleType", header: "Sale type",
      cell: ({ row }) => <span className="text-[12.5px] text-[#B45309]">{row.original.saleType}</span> },
    { accessorKey: "gatewayLabel", header: "Gateway",
      cell: ({ row }) => <span className="text-[12.5px] text-[#64748B]">{row.original.gatewayLabel ?? "—"}</span> },
    {
      id: "skus", header: () => <span className="block text-right">SKUs</span>,
      cell: ({ row }) => {
        const count = row.original.lineItems?.length;
        return <span className="block text-right text-[12.5px] text-[#64748B]">{count === undefined ? "no order on file" : `${count} item${count === 1 ? "" : "s"}`}</span>;
      },
    },
  ], []);

  const table = useReactTable({
    data: exchanges,
    columns,
    state: { expanded },
    onExpandedChange: setExpanded,
    getRowCanExpand: (row) => Boolean(row.original.lineItems?.length),
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-[#DBEAFE] bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-[#DBEAFE] bg-[#F8FAFF] px-4 py-3">
        <PackageSearch size={14} className="text-[#2563EB]" />
        <span className="text-[12.5px] font-medium text-[#0F172A]">Exchanges</span>
        <span className="text-[11.5px] text-[#64748B]">— order and SKUs, from the sheet's sale-type column</span>
      </div>
      {error && <div className="px-4 py-3 text-[12.5px] text-[#991B1B]">{(error as Error).message}</div>}
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="border-[#DBEAFE] bg-[#F8FAFF] hover:bg-[#F8FAFF]">
              {hg.headers.map((h) => (
                <TableHead key={h.id} className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B]">
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={columns.length} className="h-20 text-center"><Loader2 size={16} className="mx-auto animate-spin text-[#64748B]" /></TableCell></TableRow>
          ) : exchanges.length === 0 ? (
            <TableRow><TableCell colSpan={columns.length} className="h-20 text-center text-[13px] text-[#94A3B8]">No exchange orders in this range.</TableCell></TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <Fragment key={row.id}>
                <TableRow className="border-b border-[#EFF6FF] hover:bg-[#F8FAFF]">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2">{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
                {row.getIsExpanded() && row.original.lineItems && (
                  <TableRow className="border-b border-[#EFF6FF] bg-[#F8FAFF] hover:bg-[#F8FAFF]">
                    <TableCell colSpan={columns.length} className="py-2 pl-12">
                      <div className="space-y-1">
                        {row.original.lineItems.map((li, i) => (
                          <div key={i} className="flex items-center gap-3 text-[12px]">
                            <span className="font-mono text-[#1D4ED8]">{li.sku || "—"}</span>
                            <span className="flex-1 truncate text-[#0F172A]">{li.title}</span>
                            <span className="text-[#64748B]">×{li.qty}</span>
                            <span className="font-mono tabular-nums text-[#64748B]">AED {aed(li.totalAed)}</span>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
