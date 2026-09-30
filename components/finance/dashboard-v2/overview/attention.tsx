"use client";

/* "Needs you" — one quiet card at the top listing what blocks the month from
   closing. One line per issue, a single number each, a link to fix it.
   Hover a line for the per-gateway breakdown.
   1. Payout files to upload — sales whose gateway statement isn't in yet
   2. Bank credits with no payout file — money landed, nothing to reconcile against
   3. Payout files no bank credit has claimed
   4. Syncs that are failing (expired tokens, missing scopes) */

import { motion } from "framer-motion";
import { ArrowUpRight, Bell, CheckCircle2 } from "lucide-react";
import { compact } from "./kit";
import { ui } from "./ui";

type Group = { gateway: string; count: number; amount: number; oldest: string | null };
export type Attention = {
  bankWithoutPayout: { count: number; amount: number; byGateway: Group[]; open: { count: number; amount: number }; latest: { id: string; gateway: string; amount: number; date: string | null; reference: string }[] };
  payoutsWithoutBank: { count: number; amount: number; byGateway: Group[] };
};
export type MissingFile = { gateway: string; orders: number; grossAed: number; days: string[] };
export type SyncIssue = { source: string; error: string };

function Line({ dot, label, value, detail, href, cta, title }: {
  dot: string; label: string; value: string; detail: string; href?: string; cta?: string; title?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-2.5" title={title}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-slate-600">
        <span className="font-medium text-slate-900">{label}</span> · {detail}
      </span>
      <span className="shrink-0 text-[13.5px] font-semibold tabular-nums text-slate-900">{value}</span>
      {href && (
        <a href={href} className="inline-flex shrink-0 items-center gap-0.5 text-[12.5px] font-medium text-[#2563EB] hover:underline">
          {cta} <ArrowUpRight size={12} />
        </a>
      )}
    </div>
  );
}

export function AttentionStrip({
  missing, attention, syncIssues, loading,
}: { missing: MissingFile[]; attention: Attention | null; syncIssues: SyncIssue[]; loading: boolean }) {
  const bw = attention?.bankWithoutPayout;
  const pw = attention?.payoutsWithoutBank;
  const missingSum = missing.reduce((s, m) => s + m.grossAed, 0);
  const missingOrders = missing.reduce((s, m) => s + m.orders, 0);
  const breakdown = (rows: { gateway: string; n: number; amount: number }[]) => rows.map((r) => `${r.gateway}: ${r.n} · AED ${compact(r.amount)}`).join("\n");

  const lines = [
    missing.length > 0 && (
      <Line key="files" dot="#E11D48" label="Upload payout files" value={`AED ${compact(missingSum)}`}
        detail={`${missingOrders} sales · ${missing.map((m) => m.gateway).join(", ")}`}
        title={breakdown(missing.map((m) => ({ gateway: m.gateway, n: m.orders, amount: m.grossAed })))}
        href="/payouts" cta="Upload" />
    ),
    bw && bw.count > 0 && (
      <Line key="bank" dot="#F59E0B" label="Bank credits without a payout file" value={`AED ${compact(bw.amount)}`}
        detail={`${bw.count} this month · ${bw.open.count} open overall`}
        title={breakdown(bw.byGateway.map((g) => ({ gateway: g.gateway, n: g.count, amount: g.amount })))}
        href="/reconciliation" cta="Reconcile" />
    ),
    pw && pw.count > 0 && (
      <Line key="payouts" dot="#3B82F6" label="Payout files without a bank credit" value={`AED ${compact(pw.amount)}`}
        detail={`${pw.count} files`}
        title={breakdown(pw.byGateway.map((g) => ({ gateway: g.gateway, n: g.count, amount: g.amount })))}
        href="/reconciliation" cta="Review" />
    ),
    syncIssues.length > 0 && (
      <Line key="sync" dot="#94A3B8" label={`${syncIssues.length} sync${syncIssues.length > 1 ? "s" : ""} failing`} value=""
        detail={syncIssues.map((s) => s.source).join(", ")}
        title={syncIssues.map((s) => `${s.source}: ${s.error}`).join("\n")} />
    ),
  ].filter(Boolean);

  if (loading && lines.length === 0) return null;

  return (
    <>
     <Bell size={16} className="relative z-10 text-slate-400 group-hover:text-slate-900" />

    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`group-hover:block hidden absolute top-2 translate-x-1/2 -right-[50%] w-[350px] !p-0 ${ui.card}`}
      >
     
      {lines.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-3 text-[13px] text-slate-600">
          <CheckCircle2 size={15} className="text-[#10B981]" /> Nothing blocking the close.
        </div>
      ) : (
        <div className="grid  max-w-[300px] divide-y divide-slate-100 lg:grid-cols-2 lg:divide-y-0 [&>*:nth-child(n+3)]:lg:border-t [&>*:nth-child(n+3)]:lg:border-slate-100 [&>*:nth-child(odd)]:lg:border-r [&>*:nth-child(odd)]:lg:border-slate-100">
          {lines}
        </div>
      )}
    </motion.div>
      </>
  );
}
