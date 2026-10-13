"use client";

import { useState } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronDown, Info, ListChecks, Loader2, Sparkles } from "lucide-react";
import type { CloseFlag, GatewayRecon } from "@/lib/reconciliation/ledger-close";
import type { LedgerTotals } from "@/lib/reconciliation/ledger-insights";
import { gatewayColor } from "./colors";
import { aed2 } from "./types";

/* Month-end close: where each gateway stands, what blocks the close, and an
 * optional AI-ordered plan. Sits right under the headline tiles because it is
 * the part of the tab the accountant acts on. */

type Plan = { summary: string; steps: { title: string; why: string; flag_id: string | null; impact_aed: number | null }[] };

const SEVERITY = {
  critical: { Icon: AlertOctagon, tone: "text-[#A6472F]", chip: "bg-[#FCF4F1] text-[#A6472F] ring-[#EBC9BE]", label: "Blocks close" },
  warning: { Icon: AlertTriangle, tone: "text-[#B0742E]", chip: "bg-[#FDF9F1] text-[#8A5A14] ring-[#E7D3B0]", label: "Review" },
  info: { Icon: Info, tone: "text-[#2E6B7A]", chip: "bg-[#F4F8F9] text-[#2E6B7A] ring-[#D8E3E6]", label: "Housekeeping" },
} as const;

const STATUS = {
  clean: { label: "Reconciled", cls: "bg-[#F4F8F4] text-[#4B7A54] ring-[#CFE0D2]" },
  pending: { label: "Pending", cls: "bg-[#FDF9F1] text-[#8A5A14] ring-[#E7D3B0]" },
  attention: { label: "Needs attention", cls: "bg-[#FCF4F1] text-[#A6472F] ring-[#EBC9BE]" },
} as const;

const th = "px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-[#5E6B85]";
const num = "px-3 py-2 text-right font-mono tabular-nums";

function FlagRow({ f, onFocus, highlighted }: { f: CloseFlag; onFocus: (f: CloseFlag) => void; highlighted: boolean }) {
  const [open, setOpen] = useState(false);
  const s = SEVERITY[f.severity];
  return (
    <li id={`flag-${f.id}`} className={`px-4 py-3 transition-colors ${highlighted ? "bg-[#EAF1FD]" : ""}`}>
      <div className="flex items-start gap-2.5">
        <s.Icon size={15} className={`mt-0.5 shrink-0 ${s.tone}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[13px] font-medium text-[#0F1B3D]">{f.title}</span>
            <span className="font-mono text-[12.5px] tabular-nums text-[#0F1B3D]">{aed2(f.amount)}</span>
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[#46546F]">{f.suggestion}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ring-inset ${s.chip}`}>{s.label}</span>
            {f.focus && (
              <button onClick={() => onFocus(f)} className="text-[12px] font-medium text-[#8A5A14] hover:underline">
                Show the {f.count} line{f.count === 1 ? "" : "s"} ↓
              </button>
            )}
            {f.items && f.items.length > 0 && (
              <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-0.5 text-[12px] font-medium text-[#8A5A14] hover:underline">
                {open ? "Hide" : "List"} {f.count > f.items.length ? `top ${f.items.length}` : "them"}
                <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
              </button>
            )}
          </div>
          {open && f.items && (
            <ul className="mt-2 divide-y divide-[#EDF1F9] rounded-lg border border-[#D8E1F1] bg-white">
              {f.items.map((it, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-[12px]">
                  <span className="min-w-0 truncate text-[#0F1B3D]" title={it.label}>{it.label}{it.note && <span className="ml-1.5 text-[#5E6B85]">{it.note}</span>}</span>
                  <span className="shrink-0 font-mono tabular-nums text-[#0F1B3D]">{aed2(it.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

export function LedgerClosePanel({ month, gateways, flags, totals, onFocus }: {
  month: string;
  gateways: GatewayRecon[];
  flags: CloseFlag[];
  totals: LedgerTotals;
  onFocus: (f: CloseFlag) => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);

  const critical = flags.filter((f) => f.severity === "critical").length;
  const recTotal = gateways.reduce((t, g) => t + g.reconciled, 0);
  const pendTotal = gateways.reduce((t, g) => t + g.pending, 0);
  const pct = recTotal + pendTotal > 0 ? Math.round((recTotal / (recTotal + pendTotal)) * 1000) / 10 : 100;
  // What still has to move before the ledger closes: every clearing account
  // must end at zero, so the remaining amount is the sum of their balances
  // (either sign — money parked or over-cleared). Pending is this month's part.
  const leftOf = (g: GatewayRecon) => Math.abs(g.balance ?? g.pending);
  const remaining = Math.round(gateways.reduce((t, g) => t + leftOf(g), 0) * 100) / 100;
  const blockingAed = flags.filter((f) => f.severity === "critical").reduce((t, f) => t + Math.abs(f.amount), 0);
  const openAccounts = gateways.filter((g) => leftOf(g) >= 1).sort((a, b) => leftOf(b) - leftOf(a));

  const askAi = async () => {
    setAsking(true); setPlanErr(null);
    try {
      const res = await fetch("/api/zoho/ledger/advice", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          flags: flags.map(({ id, severity, title, amount, count, suggestion }) => ({ id, severity, title, amount, count, suggestion })),
          gateways: gateways.map(({ name, moneyIn, moneyOut, reconciled, pending, balance, pct }) => ({ name, moneyIn, moneyOut, reconciled, pending, balance, pct })),
          totals,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPlan(json.plan);
    } catch (e) {
      setPlanErr((e as Error).message);
    } finally {
      setAsking(false);
    }
  };

  const jumpToFlag = (id: string) => {
    setHighlight(id);
    document.getElementById(`flag-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setHighlight(null), 2500);
  };

  return (
    <div className="space-y-4">
    {/* ── Remaining to close ── */}
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-[#D8E1F1] bg-white px-5 py-4 shadow-sm">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#5E6B85]">Remaining to close the ledger</div>
        <div className={`mt-0.5 font-mono text-[26px] tabular-nums tracking-[-0.02em] ${remaining >= 1 ? "text-[#8A5A14]" : "text-[#4B7A54]"}`}>{remaining >= 1 ? aed2(remaining) : "AED 0.00 — closed"}</div>
        <div className="text-[12px] text-[#5E6B85]">
          sum of clearing balances still to reach zero · {aed2(pendTotal)} pending this month{critical ? ` · ${critical} blocking item${critical === 1 ? "" : "s"} (${aed2(blockingAed)})` : ""}
        </div>
      </div>
      {openAccounts.length > 0 && (
        <ul className="flex flex-1 flex-wrap gap-2">
          {openAccounts.map((g) => (
            <li key={g.accountId} className="inline-flex items-center gap-2 rounded-full bg-[#F3F6FC] px-3 py-1.5 text-[12px] ring-1 ring-inset ring-[#D8E1F1]">
              <i className="h-2 w-2 rounded-full" style={{ background: gatewayColor(g.gateway) }} aria-hidden />
              <span className="text-[#0F1B3D]">{g.name}</span>
              <span className="font-mono tabular-nums text-[#8A5A14]">{aed2(leftOf(g))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      {/* ── Gateways ── */}
      <div className="overflow-hidden rounded-2xl border border-[#D8E1F1] bg-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[#D8E1F1] px-5 py-3.5">
          <div>
            <h3 className="text-[14.5px] font-semibold text-[#0F1B3D]">Gateway reconciliation</h3>
            <p className="text-[12.5px] text-[#5E6B85]">Clearing-account movement tied to an Omnia payout vs still pending, this month.</p>
          </div>
          <div className="text-right">
            <div className="font-normal tracking-[-0.02em] text-[22px] tabular-nums text-[#0F1B3D]">{pct}%</div>
            <div className="text-[11px] text-[#5E6B85]">reconciled · {aed2(pendTotal)} pending</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-[#F3F6FC]">
                <th className={`${th} text-left`}>Gateway account</th>
                <th className={`${th} text-right`}>Reconciled</th>
                <th className={`${th} text-right`}>Pending</th>
                <th className={`${th} text-left`}>Progress</th>
                <th className={`${th} text-right`}>Balance now</th>
                <th className={`${th} text-right`}>Left to close</th>
                <th className={`${th} text-left`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {gateways.map((g) => (
                <tr key={g.accountId} className="border-t border-[#EDF1F9]">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2 font-medium text-[#0F1B3D]">
                      <i className="h-2.5 w-2.5 rounded-full" style={{ background: gatewayColor(g.gateway) }} aria-hidden />{g.name}
                    </span>
                  </td>
                  <td className={`${num} text-[#0F1B3D]`}>{aed2(g.reconciled)}</td>
                  <td className={`${num} ${g.pending ? "text-[#8A5A14]" : "text-[#97A3BA]"}`}>{g.pending ? aed2(g.pending) : "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[#EDF1F9]" role="progressbar" aria-valuenow={g.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.name} reconciled`}>
                        <div className="h-full rounded-full bg-[#4B7A54]" style={{ width: `${g.pct}%` }} />
                      </div>
                      <span className="w-11 text-right text-[11.5px] tabular-nums text-[#46546F]">{g.pct}%</span>
                    </div>
                  </td>
                  <td className={`${num} ${Math.abs(g.balance ?? 0) >= 1 ? "text-[#8A5A14]" : "text-[#0F1B3D]"}`}>{g.balance != null ? aed2(g.balance) : "—"}</td>
                  <td className={`${num} font-medium ${leftOf(g) >= 1 ? "text-[#8A5A14]" : "text-[#4B7A54]"}`}>{leftOf(g) >= 1 ? aed2(leftOf(g)) : "✓"}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS[g.status].cls}`}>{STATUS[g.status].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Close checklist + AI ── */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-[#D8E1F1] bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-[#D8E1F1] px-5 py-3.5">
          <div>
            <h3 className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-[#0F1B3D]"><ListChecks size={15} className="text-[#1D4ED8]" aria-hidden /> Close checklist</h3>
            <p className="text-[12.5px] text-[#5E6B85]">
              {flags.length === 0 ? "Nothing blocking the close." : `${flags.length} item${flags.length === 1 ? "" : "s"}${critical ? ` · ${critical} blocking` : ""}`}
            </p>
          </div>
          <button
            onClick={askAi}
            disabled={asking || flags.length === 0}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#0F1B3D] px-3 text-[12px] font-medium text-[#F3F6FC] hover:bg-[#3A332A] disabled:opacity-50"
          >
            {asking ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Sparkles size={13} aria-hidden />}
            {plan ? "Re-plan" : "Suggest close plan"}
          </button>
        </div>

        {(plan || planErr) && (
          <div className="border-b border-[#D8E1F1] bg-[#FDFBF7] px-5 py-3">
            {planErr ? (
              <p className="text-[12.5px] text-[#A6472F]">Couldn&apos;t get a plan: {planErr}</p>
            ) : plan && (
              <>
                <p className="text-[12.5px] leading-relaxed text-[#0F1B3D]"><Sparkles size={12} className="-mt-0.5 mr-1 inline text-[#1D4ED8]" aria-hidden />{plan.summary}</p>
                <ol className="mt-2 space-y-1.5">
                  {plan.steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-[12.5px]">
                      <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#0F1B3D] text-[10px] font-semibold text-[#F3F6FC]">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="font-medium text-[#0F1B3D]">
                          {s.title}
                          {s.impact_aed != null && <span className="ml-1.5 font-mono text-[11.5px] font-normal text-[#46546F]">{aed2(s.impact_aed)}</span>}
                        </div>
                        <div className="text-[12px] text-[#46546F]">
                          {s.why}
                          {s.flag_id && flags.some((f) => f.id === s.flag_id) && (
                            <button onClick={() => jumpToFlag(s.flag_id!)} className="ml-1.5 font-medium text-[#8A5A14] hover:underline">See item</button>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-[11px] text-[#5E6B85]">AI-suggested order of work from the figures on this page. Check before acting.</p>
              </>
            )}
          </div>
        )}

        {flags.length === 0 ? (
          <div className="flex flex-1 items-center justify-center gap-2 px-6 py-10 text-[13px] text-[#4B7A54]">
            <CheckCircle2 size={16} aria-hidden /> Books are clean for this month.
          </div>
        ) : (
          <ul className="max-h-[520px] divide-y divide-[#EDF1F9] overflow-y-auto">
            {flags.map((f) => <FlagRow key={f.id} f={f} onFocus={onFocus} highlighted={highlight === f.id} />)}
          </ul>
        )}
      </div>
    </div>
    </div>
  );
}
