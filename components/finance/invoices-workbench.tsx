"use client";

import { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  AlertTriangle, ArrowLeftRight, CheckCircle2, ChevronDown, Loader2, RefreshCw, Search,
} from "lucide-react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { PublishProgressDialog } from "./publish-progress-dialog";
import type { WorkbenchInvoice, WorkbenchResponse, ZohoInvoiceStatus } from "@/lib/finance/types";

type ZohoAccount = { account_id: string; account_name: string };

const AED = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const aed = (n: number) => AED.format(n);

const STATUS_LABELS: Record<string, string> = {
  all: "All", unpaid: "Unpaid", overdue: "Overdue", partially_paid: "Partial",
  paid: "Paid", sent: "Sent", draft: "Draft", viewed: "Viewed", void: "Void",
};

const STATUS_TONE: Record<string, string> = {
  overdue: "bg-[#F9ECE7] text-[#A6472F] border-transparent",
  unpaid: "bg-[#F3EFE7] text-[#6F5325] border-transparent",
  partially_paid: "bg-[#FBF2E6] text-[#B0742E] border-transparent",
  paid: "bg-[#F0F5EF] text-[#4B7A54] border-transparent",
};

export function InvoicesWorkbench() {
  // Filters
  const [range, setRange] = useState<DateRange>({ from: subDays(new Date(), 7), to: new Date() });
  const [status, setStatus] = useState<ZohoInvoiceStatus | "all">("unpaid");
  const [gateway, setGateway] = useState("all");
  const [q, setQ] = useState("");
  const [exchangesOnly, setExchangesOnly] = useState(false);
  const PAGE_SIZE = 50;

  const [page, setPage] = useState(1);
  const [pageSize] = useState(PAGE_SIZE);
  // Data + selection
  const [data, setData] = useState<WorkbenchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Publish setup
  const [accounts, setAccounts] = useState<ZohoAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [publishDate, setPublishDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [customRef, setCustomRef] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);

  // Load accounts once
  useEffect(() => {
    fetch("/api/integrations/zoho/account-config")
      .then((r) => r.json())
      .then((d) => {
        setAccounts(d.bankAccounts ?? []);
        setAccountId(d.effective?.bankAccountId ?? "");
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    setPage(1);
  }, [range.from, range.to, status]);

  const fetchInvoices = async () => {
    if (!range.from || !range.to) return;
  
    setLoading(true);
    setError(null);
  
    try {
      const url = new URL("/api/invoices/workbench", window.location.origin);
  
      url.searchParams.set("from", format(range.from, "yyyy-MM-dd"));
      url.searchParams.set("to", format(range.to, "yyyy-MM-dd"));
      url.searchParams.set("status", status);
  
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));
  
      const res = await fetch(url.toString());
  
      const json = await res.json();
  
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
  
      setData(json);
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [range.from, range.to, status, page]);

  // Client-side filters — instant, no refetch
  const displayed = useMemo(() => {
    if (!data) return [];
    let rows = data.invoices;
    if (gateway !== "all") rows = rows.filter((r) => r.gateway === gateway);
    if (exchangesOnly) rows = rows.filter((r) => r.isExchange);
    if (q?.trim()) {
      const n = q?.toLowerCase()?.trim();
      rows = rows.filter(
        (r) =>
          r?.invoiceNumber?.toLowerCase()?.includes(n) ||
          (r?.orderNumber?.toLowerCase()?.includes(n) ?? false) ||
          r?.customerName?.toLowerCase()?.includes(n),
      );
    }
    return rows;
  }, [data, gateway, exchangesOnly, q]);

  const totalBalance = displayed.reduce((s, r) => s + r.balance, 0);
  const selectedRows = displayed.filter((r) => selected.has(r.invoiceId));
  const selectedBalance = selectedRows.reduce((s, r) => s + r.balance, 0);

  const gatewayOptions = useMemo(() => {
    if (!data) return ["all"];
    return ["all", ...Object.keys(data.gatewayCounts).sort()];
  }, [data]);

  const toggleAll = () => {
    if (selected.size === displayed.length) setSelected(new Set());
    else setSelected(new Set(displayed.map((r) => r.invoiceId)));
  };
  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const openPublish = () => {
    if (!accountId) return toast.error("Pick a deposit account");
    if (selectedRows.length === 0) return toast.error("Select at least one invoice");
    setPublishOpen(true);
  };

  const onPublishDone = (ok: number, failed: number, skipped: number) => {
    const parts = [`${ok} recorded`];
    if (failed) parts.push(`${failed} failed`);
    if (skipped) parts.push(`${skipped} skipped`);
    (failed > 0 ? toast.warning : toast.success)(parts.join(" · "));
    fetchInvoices();
  };

  return (
    <div className="space-y-4">
      {/* ── Filter bar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#EAE3D6] bg-white p-3 shadow-sm">
        <DateRangePicker range={range} onChange={setRange} />

        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="h-9 w-32 border-[#D6CCBA]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["unpaid", "overdue", "partially_paid", "all"] as const).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={gateway} onValueChange={setGateway}>
          <SelectTrigger className="h-9 w-44 border-[#D6CCBA]"><SelectValue placeholder="Gateway" /></SelectTrigger>
          <SelectContent>
            {gatewayOptions.map((g) => (
              <SelectItem key={g} value={g}>
                {g === "all" ? "All gateways" : g}
                {g !== "all" && data ? ` · ${data.gatewayCounts[g] ?? 0}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative min-w-[220px] flex-1 max-w-xs">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8A8175]" />
          <Input
            placeholder="Search invoice · order · customer"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 border-[#D6CCBA] pl-8"
          />
        </div>

        <Button
          size="sm"
          variant={exchangesOnly ? "default" : "outline"}
          onClick={() => setExchangesOnly((v) => !v)}
          className={exchangesOnly ? "h-9 bg-[#B08343] text-white hover:bg-[#9a723a]" : "h-9 border-[#D6CCBA]"}
        >
          <ArrowLeftRight size={13} className="mr-1.5" />
          Exchanges
          {data && data.totalPages > 1 && (
                    <div className="flex items-center justify-between border-t border-[#EAE3D6] bg-[#FBF8F1] px-4 py-3">
                        <div className="text-[12px] text-[#8A8175]">
                        Showing{" "}
                        <span className="font-medium text-[#1F1B16]">
                            {(page - 1) * pageSize + 1}
                        </span>
                        {"–"}
                        <span className="font-medium text-[#1F1B16]">
                            {Math.min(page * pageSize, data.total)}
                        </span>
                        {" of "}
                        <span className="font-medium text-[#1F1B16]">
                            {data.total}
                        </span>
                        {" invoices"}
                        </div>

                        <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={loading || page <= 1}
                            onClick={() => setPage((p) => p - 1)}
                            className="h-8 border-[#D6CCBA]"
                        >
                            Previous
                        </Button>

                        <span className="px-2 text-[12px] text-[#6F5325]">
                            Page {page} of {data.totalPages}
                        </span>

                        <Button
                            size="sm"
                            variant="outline"
                            disabled={loading || page >= data.totalPages}
                            onClick={() => setPage((p) => p + 1)}
                            className="h-8 border-[#D6CCBA]"
                        >
                            Next
                        </Button>
                        </div>
                    </div>
                    )}

        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={fetchInvoices}
          disabled={loading}
          className="ml-auto h-9 border-[#D6CCBA]"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </Button>
      </div>

      {/* ── Summary strip ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12.5px] text-[#6F5325]">
        <span><b className="text-[#1F1B16]">{displayed.length}</b> invoices</span>
        <span className="text-[#D6CCBA]">·</span>
        <span>Total balance <b className="tabular-nums text-[#1F1B16]">AED {aed(totalBalance)}</b></span>
        {selectedRows.length > 0 && (
          <>
            <span className="text-[#D6CCBA]">·</span>
            <span className="text-[#B08343]">
              <b>{selectedRows.length}</b> selected · <b className="tabular-nums">AED {aed(selectedBalance)}</b>
            </span>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-[#F9ECE7] px-4 py-3 text-[13px] text-[#A6472F]">{error}</div>
      )}

      {/* ── Table ──────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-[#EAE3D6] bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-[#EAE3D6] bg-[#FBF8F1] hover:bg-[#FBF8F1]">
              <TableHead className="w-10">
                <Checkbox
                  checked={displayed.length > 0 && selected.size === displayed.length}
                  onCheckedChange={toggleAll}
                  disabled={loading}
                />
              </TableHead>
              <ColHead>Date</ColHead>
              <ColHead>Invoice</ColHead>
              <ColHead>Order</ColHead>
              <ColHead>Customer</ColHead>
              <ColHead>Gateway</ColHead>
              <ColHead align="right">Total</ColHead>
              <ColHead align="right">Balance</ColHead>
              <ColHead>Status</ColHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-[#8A8175]">
                  <Loader2 size={16} className="mx-auto animate-spin" />
                </TableCell>
              </TableRow>
            ) : displayed.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-[#8A8175]">
                  No invoices match this filter.
                </TableCell>
              </TableRow>
            ) : (
              displayed.map((row,i) => (
                <InvoiceRow
                  key={i}
                  row={row}
                  selected={selected.has(row.invoiceId)}
                  onToggle={() => toggleRow(row.invoiceId)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Sticky publish bar ─────────────────────────────────────── */}
      {selectedRows.length > 0 && (
        <div className="sticky bottom-18 z-10 mx-auto flex max-w-5xl flex-wrap items-center gap-2 rounded-xl border border-[#B08343] bg-white p-3 shadow-xl">
          <span className="text-[13px] font-medium text-[#1F1B16]">
            {selectedRows.length} selected · <span className="tabular-nums">AED {aed(selectedBalance)}</span>
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={publishDate}
              onChange={(e) => setPublishDate(e.target.value)}
              className="h-9 w-40 border-[#D6CCBA]"
            />
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="h-9 w-60 border-[#D6CCBA]">
                <SelectValue placeholder="Deposit account…" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.account_id} value={a.account_id}>{a.account_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Reference (optional)"
              value={customRef}
              onChange={(e) => setCustomRef(e.target.value)}
              className="h-9 w-40 border-[#D6CCBA]"
            />
            <Button onClick={openPublish} disabled={!accountId} className="h-9 bg-[#6F5325] text-white hover:bg-[#5A4320]">
              <CheckCircle2 size={14} className="mr-1.5" />
              Record {selectedRows.length}
            </Button>
          </div>
        </div>
      )}

      {publishOpen && (
        <PublishProgressDialog
          invoiceIds={selectedRows.map((r) => r.invoiceId)}
          accountId={accountId}
          date={publishDate}
          referenceOverride={customRef?.trim() || undefined}
          onClose={() => setPublishOpen(false)}
          onDone={onPublishDone}
        />
      )}
    </div>
  );
}

/* ── Row ──────────────────────────────────────────────────────────── */

function InvoiceRow({ row, selected, onToggle }: {
  row: WorkbenchInvoice; selected: boolean; onToggle: () => void;
}) {
  const isFeeResidual = row.residualCategory === "fee_residual";
  const isPartial = row.residualCategory === "partial_payment";
  const border = row.isExchange
    ? "border-l-4 border-l-[#B0742E]"
    : isFeeResidual
    ? "border-l-4 border-l-[#B08343]"
    : "";

  return (
    <TableRow
      className={`border-[#EAE3D6] transition-colors ${border} ${
        selected ? "bg-[#FBF3E6]" : "hover:bg-[#FBF8F1]"
      }`}
    >
      <TableCell className="w-10 py-2"><Checkbox checked={selected} onCheckedChange={onToggle} /></TableCell>
      <TableCell className="py-2 text-[12.5px] tabular-nums text-[#1F1B16]">{row.invoiceDate}</TableCell>
      <TableCell className="py-2 font-mono text-[12.5px] text-[#1F1B16]">{row.invoiceNumber}</TableCell>
      <TableCell className="py-2 font-mono text-[12.5px]">
        <div className="flex items-center gap-1.5">
          <span className="text-[#1F1B16]">{row.orderNumber ?? "—"}</span>
          {row.isExchange && (
            <span
              className="inline-flex items-center rounded-md bg-[#FBF2E6] px-1.5 py-0.5 text-[9px] font-bold text-[#B0742E]"
              title={`Exchange — ${row.exchangeSiblings.length + 1} invoices for this order: ${row.exchangeSiblings.map((s) => `${s.invoiceNumber} (${s.status})`).join(", ")}`}
            >
              EX
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="max-w-[240px] truncate py-2 text-[12.5px] text-[#1F1B16]" title={row.customerName}>
        {row.customerName}
      </TableCell>
      <TableCell className="py-2 text-[12.5px]">
        <Badge
          variant="outline"
          className={`border-[#D6CCBA] font-normal ${
            row.gatewaySource === "unknown" ? "border-[#F5D3C6] text-[#A6472F]" : "text-[#6F5325]"
          }`}
        >
          {row.gateway}
        </Badge>
      </TableCell>
      <TableCell className="py-2 text-right font-mono text-[12.5px] tabular-nums text-[#8A8175]">
        {aed(row.total)}
      </TableCell>
      <TableCell className="py-2 text-right font-mono text-[12.5px] tabular-nums">
        <div className="flex items-center justify-end gap-1">
          {isFeeResidual && (
            <span title="Prior payment exists — residual is likely a gateway fee (Aug 11 broken batch)">
              <AlertTriangle size={11} className="text-[#B0742E]" />
            </span>
          )}
          <span className={isFeeResidual ? "font-medium text-[#B0742E]" : "font-medium text-[#1F1B16]"}>
            {aed(row.balance)}
          </span>
        </div>
      </TableCell>
      <TableCell className="py-2">
        <div className="flex items-center gap-1">
          <Badge variant="secondary" className={`text-[10.5px] font-medium ${STATUS_TONE[row.status] ?? "bg-[#F3EFE7] text-[#8A8175]"}`}>
            {STATUS_LABELS[row.status] ?? row.status}
          </Badge>
          {isPartial && (
            <span className="text-[9.5px] text-[#8A8175]" title="Legitimate partial payment on file">partial</span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function ColHead({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <TableHead
      className={`text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175] ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </TableHead>
  );
}

/* ── Date range picker ────────────────────────────────────────────── */

function DateRangePicker({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 min-w-[220px] justify-start border-[#D6CCBA]">
          <span className="mr-2 text-[#8A8175]">Date:</span>
          <span className="text-[#1F1B16]">
            {range.from ? format(range.from, "d MMM") : "—"} → {range.to ? format(range.to, "d MMM") : "—"}
          </span>
          <ChevronDown size={13} className="ml-auto text-[#8A8175]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={range}
          onSelect={(r) => r && onChange(r)}
          numberOfMonths={2}
          defaultMonth={range.from}
        />
      </PopoverContent>
    </Popover>
  );
}