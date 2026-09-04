"use client";

/* Received vs. pending trend, bucketed daily/weekly/monthly, straight off
   the payments sheet — Zoho-free (see lib/finance/payments-sheet.ts), so
   this renders even when Zoho is rate limited. Pure client-side bucketing
   over the row set the insights panel already fetched — no extra requests
   per granularity toggle. */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { PaymentSheetRow } from "@/lib/finance/payments-sheet-insights";

type Granularity = "daily" | "weekly" | "monthly";

const AED = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const aed = (n: number) => AED.format(n);

function bucketKey(iso: string, granularity: Granularity): string {
  if (granularity === "daily") return iso;
  const d = new Date(iso + "T00:00:00Z");
  if (granularity === "monthly") return iso.slice(0, 7);
  // Weekly: Monday-anchored ISO week start.
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

function bucketLabel(key: string, granularity: Granularity): string {
  if (granularity === "monthly") {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  const d = new Date(key + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Bucket = { key: string; label: string; received: number; pending: number; cancelled: number };

function buildBuckets(rows: PaymentSheetRow[], granularity: Granularity): Bucket[] {
  const byKey = new Map<string, Bucket>();
  for (const row of rows) {
    if (!row.date) continue;
    const key = bucketKey(row.date, granularity);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { key, label: bucketLabel(key, granularity), received: 0, pending: 0, cancelled: 0 };
      byKey.set(key, bucket);
    }
    const isReceived = row.actualPaymentStatus.toLowerCase() === "payment received";
    const isCancelled = row.cancelledAmount > 0;
    if (isCancelled) bucket.cancelled += row.cancelledAmount;
    if (isReceived) bucket.received += row.amountAed;
    else if (!isCancelled) bucket.pending += row.amountAed;
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const GRANULARITY_OPTIONS: { key: Granularity; label: string; tailBuckets: number }[] = [
  { key: "daily", label: "Daily", tailBuckets: 30 },
  { key: "weekly", label: "Weekly", tailBuckets: 16 },
  { key: "monthly", label: "Monthly", tailBuckets: 12 },
];

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#1E3A8A]/20 bg-[#0B1E4D] px-3 py-2 shadow-xl">
      <div className="mb-1 text-[11px] font-medium text-[#93C5FD]">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-[11.5px]">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-[#CBD5E1]">{p.name}:</span>
          <span className="font-mono font-medium text-white">AED {aed(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function SheetTrendChart({ rows }: { rows: PaymentSheetRow[] }) {
  const [granularity, setGranularity] = useState<Granularity>("daily");

  const opt = GRANULARITY_OPTIONS.find((g) => g.key === granularity)!;
  const buckets = useMemo(() => {
    const all = buildBuckets(rows, granularity);
    return all.slice(-opt.tailBuckets);
  }, [rows, granularity, opt.tailBuckets]);

  const totals = useMemo(
    () => buckets.reduce((acc, b) => ({ received: acc.received + b.received, pending: acc.pending + b.pending }), { received: 0, pending: 0 }),
    [buckets],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="overflow-hidden rounded-2xl border border-[#1E3A8A]/30 shadow-lg"
      style={{ background: "linear-gradient(160deg, #0B1E4D 0%, #0F2942 55%, #0B1E4D 100%)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#93C5FD]">Payments trend</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-[24px] font-semibold tabular-nums text-white">AED {aed(totals.received)}</span>
            <span className="text-[12px] text-[#93C5FD]">received</span>
            <span className="text-[15px] tabular-nums text-[#FCD34D]">AED {aed(totals.pending)}</span>
            <span className="text-[12px] text-[#93C5FD]">awaiting</span>
          </div>
        </div>
        <div className="inline-flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
          {GRANULARITY_OPTIONS.map((g) => (
            <button
              key={g.key}
              onClick={() => setGranularity(g.key)}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                granularity === g.key ? "bg-[#2563EB] text-white shadow-sm" : "text-[#93C5FD] hover:text-white"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64 px-2 pb-4 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={buckets} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="receivedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="pendingFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FBBF24" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#FBBF24" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E3A8A" strokeOpacity={0.3} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#93C5FD", fontSize: 11 }} axisLine={{ stroke: "#1E3A8A" }} tickLine={false} />
            <YAxis
              tick={{ fill: "#93C5FD", fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={(v) => `${Math.round(v / 1000)}k`}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, color: "#93C5FD" }} />
            <Area type="monotone" dataKey="received" name="Received" stroke="#3B82F6" strokeWidth={2} fill="url(#receivedFill)" />
            <Area type="monotone" dataKey="pending" name="Awaiting" stroke="#FBBF24" strokeWidth={2} fill="url(#pendingFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
