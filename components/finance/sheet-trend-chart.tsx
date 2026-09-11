"use client";

/* Payments trend off the payments sheet — Zoho-free (see
   lib/finance/payments-sheet.ts), so it renders even when Zoho is rate
   limited. Pure client-side bucketing over the row set the panel already
   fetched — no extra requests per toggle.

   Three modes:
     • Gross sales — every order's value, by ORDER date, paid or not.
     • Net sales  — after-fee amount for that month's orders once their
       payout is confirmed, by ORDER date. Amber line = orders still
       awaiting a payout (becomes net later).
     • Payout cash — money that actually SETTLED each period, by settlement
       date. Violet line = the part that was for earlier-month orders.

   Light card, matching the rest of the dashboard. Every recharts series is
   a direct child of <ComposedChart> — fragment-wrapped series are silently
   dropped by recharts 2.x. */

import { useMemo, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { grossFeeNetForRow, type PaymentSheetRow } from "@/lib/finance/payments-sheet-insights";

type Granularity = "daily" | "weekly" | "monthly";
type Mode = "gross" | "net" | "cash";

const AED = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const aed = (n: number) => AED.format(n);
const compact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));

const C = {
  gross: "#2E6B7A",   // teal — matches the dashboard's Gross
  net: "#4B7A54",     // green — Net
  awaiting: "#B0742E", // amber — Awaiting
  cash: "#2E6B7A",
  carried: "#7C3AED", // violet — carried in
};

function bucketKey(iso: string, g: Granularity): string {
  if (g === "daily") return iso;
  if (g === "monthly") return iso.slice(0, 7);
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday-anchored week
  return d.toISOString().slice(0, 10);
}
function bucketLabel(key: string, g: Granularity): string {
  if (g === "monthly") {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  return new Date(key + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Bucket = { key: string; label: string; gross: number; net: number; awaiting: number; received: number; carried: number };

function buildBuckets(rows: PaymentSheetRow[], g: Granularity, mode: Mode, from: string | null, to: string | null): Bucket[] {
  const byKey = new Map<string, Bucket>();
  const get = (iso: string) => {
    const key = bucketKey(iso, g);
    let b = byKey.get(key);
    if (!b) { b = { key, label: bucketLabel(key, g), gross: 0, net: 0, awaiting: 0, received: 0, carried: 0 }; byKey.set(key, b); }
    return b;
  };
  for (const row of rows) {
    const isReceived = row.actualPaymentStatus.toLowerCase() === "payment received";
    const isCancelled = row.cancelledAmount > 0;
    const { gross, net } = grossFeeNetForRow(row);
    if (mode === "cash") {
      if (!isReceived || !row.paymentReceivedDate) continue;
      const d = row.paymentReceivedDate;
      if ((from && d < from) || (to && d > to)) continue;
      const b = get(d);
      b.received += row.amountAed;
      const om = row.date ? row.date.slice(0, 7) : null;
      if (om && om < d.slice(0, 7)) b.carried += row.amountAed;
    } else {
      const d = row.date;
      if (!d || (from && d < from) || (to && d > to)) continue;
      const b = get(d);
      b.gross += gross;
      if (isReceived) b.net += net;
      else if (!isCancelled) b.awaiting += gross;
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const GRAN: { key: Granularity; label: string; tail: number }[] = [
  { key: "daily", label: "Daily", tail: 45 },
  { key: "weekly", label: "Weekly", tail: 20 },
  { key: "monthly", label: "Monthly", tail: 14 },
];
const MODES: { key: Mode; label: string }[] = [
  { key: "gross", label: "Gross sales" },
  { key: "net", label: "Net sales" },
  { key: "cash", label: "Payout cash" },
];

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#211D18", color: "#F7F2E8", borderRadius: 10, padding: "9px 12px", fontSize: 11.5, boxShadow: "0 8px 24px rgba(0,0,0,.3)" }}>
      <div style={{ fontWeight: 700, marginBottom: 5 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2.5, background: p.color, flexShrink: 0 }} />
          {p.name}
          <b style={{ marginLeft: "auto", paddingLeft: 12, fontVariantNumeric: "tabular-nums" }}>AED {aed(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

function Toggle<T extends string>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg border border-[#EAE3D6] bg-[#FBF8F1] p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
            value === o.key ? "bg-white text-[#1F1B16] shadow-sm" : "text-[#8A8175] hover:text-[#1F1B16]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SheetTrendChart({ rows, from = null, to = null }: { rows: PaymentSheetRow[]; from?: string | null; to?: string | null }) {
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [mode, setMode] = useState<Mode>("gross");

  const windowed = Boolean(from || to);
  const gran = GRAN.find((x) => x.key === granularity)!;
  const buckets = useMemo(() => {
    const all = buildBuckets(rows, granularity, mode, from, to);
    return windowed ? all : all.slice(-gran.tail);
  }, [rows, granularity, mode, from, to, windowed, gran.tail]);

  const t = useMemo(
    () => buckets.reduce(
      (a, b) => ({ gross: a.gross + b.gross, net: a.net + b.net, awaiting: a.awaiting + b.awaiting, received: a.received + b.received, carried: a.carried + b.carried }),
      { gross: 0, net: 0, awaiting: 0, received: 0, carried: 0 },
    ),
    [buckets],
  );

  const headline = mode === "gross"
    ? { big: t.gross, bigLabel: "gross sales", bigColor: C.gross, small: null as null | { v: number; l: string; c: string } }
    : mode === "net"
      ? { big: t.net, bigLabel: "net (paid)", bigColor: C.net, small: { v: t.awaiting, l: "awaiting payout", c: C.awaiting } }
      : { big: t.received, bigLabel: "received", bigColor: C.cash, small: { v: t.carried, l: "carried from earlier", c: C.carried } };

  const caption = mode === "gross"
    ? "Every order's value by the month it was placed — paid or not."
    : mode === "net"
      ? "After-fee amount for each month's orders, once their payout clears. Amber = still awaiting a payout."
      : "Cash that actually settled each period. Violet = the part that was for earlier-month orders.";

  return (
    <div className="rounded-2xl border border-[#EAE3D6] bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8A8175]">
            Payments trend
            {windowed && <span className="ml-2 font-normal normal-case text-[#B3A996]">{from ?? "…"} → {to ?? "…"}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="font-serif text-[24px] tabular-nums" style={{ color: headline.bigColor }}>AED {aed(headline.big)}</span>
            <span className="text-[12px] text-[#8A8175]">{headline.bigLabel}</span>
            {headline.small && (
              <>
                <span className="text-[15px] tabular-nums" style={{ color: headline.small.c }}>AED {aed(headline.small.v)}</span>
                <span className="text-[12px] text-[#8A8175]">{headline.small.l}</span>
              </>
            )}
          </div>
          <div className="mt-1 text-[10.5px] text-[#B3A996]">{caption}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle options={MODES} value={mode} onChange={setMode} />
          <Toggle options={GRAN.map(({ key, label }) => ({ key, label }))} value={granularity} onChange={setGranularity} />
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={buckets} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="stcGross" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.gross} stopOpacity={0.28} />
                <stop offset="100%" stopColor={C.gross} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="stcNet" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.net} stopOpacity={0.28} />
                <stop offset="100%" stopColor={C.net} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="stcCash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.cash} stopOpacity={0.28} />
                <stop offset="100%" stopColor={C.cash} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.06)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#9a8b73", fontSize: 11 }} axisLine={{ stroke: "rgba(0,0,0,.08)" }} tickLine={false} minTickGap={16} />
            <YAxis tick={{ fill: "#9a8b73", fontSize: 11 }} axisLine={false} tickLine={false} width={44} tickFormatter={compact} />
            <Tooltip content={<Tip />} />
            <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 4 }} />

            {mode === "gross" && (
              <Area key="gross" type="monotone" dataKey="gross" name="Gross sales" stroke={C.gross} strokeWidth={2} fill="url(#stcGross)" dot={false} />
            )}
            {mode === "net" && (
              <Area key="net" type="monotone" dataKey="net" name="Net (paid)" stroke={C.net} strokeWidth={2} fill="url(#stcNet)" dot={false} />
            )}
            {mode === "net" && (
              <Line key="awaiting" type="monotone" dataKey="awaiting" name="Awaiting payout" stroke={C.awaiting} strokeWidth={1.75} strokeDasharray="5 3" dot={false} />
            )}
            {mode === "cash" && (
              <Area key="received" type="monotone" dataKey="received" name="Received" stroke={C.cash} strokeWidth={2} fill="url(#stcCash)" dot={false} />
            )}
            {mode === "cash" && (
              <Line key="carried" type="monotone" dataKey="carried" name="Carried from earlier" stroke={C.carried} strokeWidth={1.75} dot={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
