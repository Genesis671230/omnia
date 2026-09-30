"use client";

/* "Does this batch tally?" — at the top of a payout's drawer.
 *
 * The strip is the computed tally (lib/finance/batch-tally.ts): what's booked,
 * what's still to book, what needs a decision, and what no line on the payout
 * file explains. It loads on open and costs no Zoho calls.
 *
 * "Review with AI" hands that tally to Claude, which can read this batch's
 * invoices, payments and credit notes in Zoho and comes back with the causes
 * and a fix + AED estimate each (lib/ai/batch-advisor.ts). Nothing is booked
 * from here — fixes go through the booking panels below. */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import type { BatchTally } from "@/lib/finance/batch-tally";
import type { BatchAdvice } from "@/lib/ai/batch-advisor";
import { aed2, type ReconLine } from "./types";

type AdviceState = { advice: BatchAdvice; model: string; lookups: number } | null;

const CONFIDENCE_TONE: Record<BatchAdvice["findings"][number]["confidence"], string> = {
  high: "bg-[#E8F2EA] text-[#2F6B3B]", medium: "bg-[#FFF4E0] text-[#8A5A00]", low: "bg-[#EEF2FA] text-[#5E6B85]",
};

export function BatchAdvisorPanel({ r }: { r: ReconLine }) {
  const [tally, setTally] = useState<BatchTally | null>(null);
  const [advice, setAdvice] = useState<AdviceState>(null);
  const [loading, setLoading] = useState<"tally" | "ai" | null>(null);
  const [error, setError] = useState("");

  const ask = useCallback(async (ai: boolean) => {
    setLoading(ai ? "ai" : "tally");
    setError("");
    try {
      const res = await fetch("/api/settlements/advice", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId: r.id, ai }),
      });
      const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (j.tally) setTally(j.tally);
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      if (ai) setAdvice({ advice: j.advice, model: j.model, lookups: j.lookups });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }, [r.id]);

  useEffect(() => { void ask(false); }, [ask]);

  const tallied = tally && Math.abs(tally.pendingAed) < 0.01 && Math.abs(tally.unexplainedAed) < 0.01;
  const pendingParts = tally
    ? [
        tally.pending.orders && `orders ${aed2(tally.pending.orders)}`,
        tally.pending.refunds && `refunds ${aed2(tally.pending.refunds)}`,
        tally.pending.deliveryCharges && `courier charges ${aed2(tally.pending.deliveryCharges)}`,
      ].filter(Boolean).join(" · ")
    : "";

  return (
    <section className="rounded-lg border border-[#D8E1F1] bg-white p-3 text-[12px] text-[#0F1B3D]" aria-label="Batch close check">
      <div className="flex flex-wrap items-center gap-2">
        {tally == null ? (
          <span className="inline-flex items-center gap-1.5 text-[#5E6B85]"><Loader2 size={13} className="animate-spin" /> Checking this batch…</span>
        ) : tallied ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#2F6B3B]"><CheckCircle2 size={14} /> This batch tallies</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#A6472F]"><AlertTriangle size={14} /> Not tallied yet</span>
        )}
        <button
          onClick={() => void ask(true)}
          disabled={loading != null}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#0F1B3D] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
        >
          {loading === "ai" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {loading === "ai" ? "Reviewing invoices and credit notes…" : advice ? "Review again" : "Review with AI"}
        </button>
      </div>

      {tally && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-5">
          <Figure label="Bank credit" value={aed2(tally.bankAmount)} />
          <Figure label="Booked" value={aed2(tally.bookedAed)} hint={`${tally.counts.ordersBooked}/${tally.counts.orders} orders${tally.counts.refunds ? ` · ${tally.counts.refundsBooked}/${tally.counts.refunds} refunds` : ""}`} />
          <Figure label="Still to book" value={pendingParts || aed2(0)} tone={pendingParts ? "warn" : undefined} />
          <Figure label="Needs a decision" value={aed2(tally.needsDecisionAed)} tone={tally.needsDecisionAed ? "warn" : undefined}
            hint={tally.counts.ordersWithGap || tally.counts.ordersWithError ? `${tally.counts.ordersWithGap} gap · ${tally.counts.ordersWithError} error` : undefined} />
          <Figure label="Unexplained" value={aed2(tally.unexplainedAed)} tone={Math.abs(tally.unexplainedAed) >= 0.01 ? "bad" : undefined}
            hint="bank credit no line on the file accounts for" />
        </dl>
      )}

      {error && <p className="mt-2 rounded-md bg-[#F9ECE7] px-2.5 py-1.5 text-[11.5px] text-[#A6472F]">{error}</p>}

      {advice && (
        <div className="mt-3 space-y-2">
          <p className="leading-relaxed">{advice.advice.summary}</p>
          {advice.advice.findings.map((f, i) => (
            <article key={i} className="rounded-md border border-[#D8E1F1] bg-[#F7F9FE] p-2.5">
              <header className="flex flex-wrap items-center gap-1.5">
                <b className="text-[12.5px]">{f.title}</b>
                <span className={`rounded-full px-1.5 text-[10.5px] ${CONFIDENCE_TONE[f.confidence]}`}>{f.confidence}</span>
                {f.estimate_aed != null && <span className="ml-auto font-semibold tabular-nums">{aed2(f.estimate_aed)}</span>}
              </header>
              {f.orders.length > 0 && <p className="mt-0.5 font-mono text-[11px] text-[#5E6B85]">{f.orders.map((o) => `#${o}`).join(" ")}</p>}
              <p className="mt-1 leading-relaxed text-[#33405C]"><span className="font-medium text-[#0F1B3D]">Why: </span>{f.cause}</p>
              <p className="mt-1 leading-relaxed text-[#1E3A8A]"><span className="font-medium">Fix: </span>{f.fix}</p>
              {f.evidence.length > 0 && <p className="mt-1 text-[11px] text-[#5E6B85]">Based on: {f.evidence.join(" · ")}</p>}
            </article>
          ))}
          {advice.advice.next_steps.length > 0 && (
            <ol className="list-decimal space-y-0.5 pl-5">
              {advice.advice.next_steps.map((s, i) => (
                <li key={i}>{s.action}{s.impact_aed != null && <span className="tabular-nums text-[#5E6B85]"> · {aed2(s.impact_aed)}</span>}</li>
              ))}
            </ol>
          )}
          <p className="text-[10.5px] text-[#9AA6BD]">{advice.model} · {advice.lookups} Zoho lookup{advice.lookups === 1 ? "" : "s"} · suggestions only, nothing was booked</p>
        </div>
      )}
    </section>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" | "bad" }) {
  const color = tone === "bad" ? "text-[#A6472F]" : tone === "warn" ? "text-[#8A5A00]" : "text-[#0F1B3D]";
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-[#5E6B85]">{label}</dt>
      <dd className={`font-semibold tabular-nums ${color}`}>{value}</dd>
      {hint && <dd className="text-[10.5px] text-[#9AA6BD]">{hint}</dd>}
    </div>
  );
}
