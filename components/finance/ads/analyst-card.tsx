"use client";

/* AI analyst — a review of the whole ad account for the range, next to the
 * store's real sales. Every review is kept, so the next one says what changed
 * since; earlier ones stay one click away. Suggestions only: nothing here
 * touches a campaign. lib/ai/ads-analyst.ts */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Clock, Loader2, Sparkles, Users, Wand2, Package } from "lucide-react";
import { toast } from "sonner";
import type { AdsReport } from "@/lib/ai/ads-analyst";
import { Card, Eyebrow } from "@/components/finance/dashboard-v2/overview/kit";
import { ui } from "@/components/finance/dashboard-v2/overview/ui";

type Stored = { id: string; created_at: string; range_from: string; range_to: string; model: string; report: AdsReport };

const STATUS: Record<AdsReport["status"], { label: string; cls: string }> = {
  healthy: { label: "Healthy", cls: "bg-emerald-50 text-emerald-700" },
  watch: { label: "Watch", cls: "bg-amber-50 text-amber-700" },
  act: { label: "Act now", cls: "bg-rose-50 text-rose-700" },
};
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function AnalystCard({ range }: { range: string }) {
  const [history, setHistory] = useState<Stored[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch("/api/ads/analyst").then((r) => r.json()).catch(() => ({ reports: [] }));
    setHistory(j.reports ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/ads/analyst", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ range }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      await load();
      setSelected(j.id);
      toast.success("New review ready");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const current = history.find((h) => h.id === selected) ?? history[0];
  const r = current?.report;

  return (
    <Card delay={0.15} className="relative overflow-hidden">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-indigo-100/60 blur-3xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow className="inline-flex items-center gap-1.5"><Sparkles size={12} className="text-indigo-500" /> AI analyst</Eyebrow>
          {current ? (
            <p className={`mt-1 ${ui.hint}`}>Review of {current.range_from} – {current.range_to} · {when(current.created_at)} · {current.model}</p>
          ) : <p className={`mt-1 ${ui.caption}`}>Reads every campaign, ad set, ad and creative alongside your real sales, and says what to scale, fix, target and when.</p>}
        </div>
        <div className="flex items-center gap-2">
          {history.length > 1 && (
            <select value={current?.id} onChange={(e) => setSelected(e.target.value)} className="h-10 rounded-full border-0 bg-white px-3 text-[12.5px] text-slate-700 ring-1 ring-slate-200" aria-label="Earlier reviews">
              {history.map((h) => <option key={h.id} value={h.id}>{when(h.created_at)}</option>)}
            </select>
          )}
          <button onClick={run} disabled={running} className={ui.darkPill}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {running ? "Reviewing the account… (~90 s)" : history.length ? "Review again" : "Run the review"}
          </button>
        </div>
      </div>

      {r && (
        <motion.div key={current.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="relative mt-5 space-y-5">
          <div className="flex flex-wrap items-start gap-3">
            <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
            <p className="min-w-0 flex-1 text-[16px] leading-snug text-slate-900">{r.headline}</p>
          </div>
          {r.since_last && <p className="rounded-2xl bg-indigo-50/70 px-4 py-3 text-[13px] leading-relaxed text-indigo-900"><b className="font-medium">Since the last review: </b>{r.since_last}</p>}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {r.happening.map((h, i) => (
              <div key={i} className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-[13.5px] font-medium text-slate-900">{h.title}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{h.detail}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ActionList title="Scale" icon={<ArrowUpRight size={14} />} tone="text-emerald-700" items={r.scale} />
            <ActionList title="Fix or pause" icon={<ArrowDownRight size={14} />} tone="text-rose-600" items={r.fix_or_pause} />
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Insight icon={<Users size={14} />} title="Audience" lead={r.audience.best} detail={r.audience.detail} suggestion={r.audience.suggestion} />
            <Insight icon={<Clock size={14} />} title="Timing" lead={r.timing.peak} detail={r.timing.detail} suggestion={r.timing.suggestion} />
            <Insight icon={<Sparkles size={14} />} title="Creatives" lead={r.creatives.best.map((c) => c.name).slice(0, 2).join(", ")} detail={r.creatives.pattern} />
            <Insight icon={<Package size={14} />} title="Products" detail={r.products.detail} suggestion={r.products.suggestion} />
          </div>

          {(r.tracking || r.next_checks.length > 0) && (
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-[12.5px] text-slate-600">
              {r.tracking && <p className="mb-1.5"><b className="font-medium text-slate-900">Tracking: </b>{r.tracking}</p>}
              {r.next_checks.length > 0 && <p><b className="font-medium text-slate-900">Check next: </b>{r.next_checks.join(" · ")}</p>}
            </div>
          )}
          <p className={ui.hint}>Suggestions from the model — nothing was changed in Meta. Purchases and ROAS are pixel-attributed.</p>
        </motion.div>
      )}
    </Card>
  );
}

function ActionList({ title, icon, tone, items }: { title: string; icon: React.ReactNode; tone: string; items: AdsReport["scale"] }) {
  return (
    <div className="rounded-2xl ring-1 ring-slate-100">
      <p className={`flex items-center gap-1.5 border-b border-slate-100 px-4 py-2.5 text-[13px] font-medium ${tone}`}>{icon}{title}<span className="text-slate-400">· {items.length}</span></p>
      {items.length === 0 ? <p className="px-4 py-3 text-[12.5px] text-slate-400">Nothing this period.</p> : (
        <ul className="divide-y divide-slate-100">
          {items.map((it) => (
            <li key={`${it.level}-${it.id}`} className="px-4 py-3">
              <p className="text-[13px] text-slate-900"><span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-slate-500">{it.level}</span><b className="font-medium">{it.name}</b></p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{it.why}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-slate-900">→ {it.action}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Insight({ icon, title, lead, detail, suggestion }: { icon: React.ReactNode; title: string; lead?: string; detail: string; suggestion?: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3">
      <p className="flex items-center gap-1.5 text-[12px] text-slate-500">{icon}{title}</p>
      {lead && <p className="mt-1 text-[14px] font-medium text-slate-900">{lead}</p>}
      <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{detail}</p>
      {suggestion && <p className="mt-1.5 text-[12.5px] leading-relaxed text-indigo-800">→ {suggestion}</p>}
    </div>
  );
}
