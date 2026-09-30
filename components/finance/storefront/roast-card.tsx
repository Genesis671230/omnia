"use client";

import { useCallback, useEffect, useState } from "react";
import { Flame, History, Loader2, ShieldCheck, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import type { SiteRoast } from "@/lib/ai/site-roast";

type Stored = { id: string; created_at: string; url: string; model: string; roast: SiteRoast };

const IMPACT: Record<string, string> = { high: "bg-[#F9ECE7] text-[#A6472F]", medium: "bg-[#FDF4E3] text-[#8A5A12]", low: "bg-[#EEF2FA] text-[#46546F]" };
const EFFORT: Record<string, string> = { quick: "Quick win", days: "Days", project: "Project" };

function ScoreRing({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const c = 2 * Math.PI * 26;
  const color = s >= 70 ? "#15803D" : s >= 45 ? "#B7791F" : "#A6472F";
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" aria-label={`Score ${s} of 100`}>
      <circle cx="34" cy="34" r="26" fill="none" stroke="#EEF2FA" strokeWidth="7" />
      <circle cx="34" cy="34" r="26" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${(s / 100) * c} ${c}`} transform="rotate(-90 34 34)" />
      <text x="34" y="39" textAnchor="middle" fontSize="17" fontWeight="700" fill="#0F1B3D">{s}</text>
    </svg>
  );
}

export function RoastCard({ site, url, range }: { site: string; url: string; range: string }) {
  const [history, setHistory] = useState<Stored[]>([]);
  const [current, setCurrent] = useState<Stored | null>(null);
  const [running, setRunning] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/storefront/roast?site=${site}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setHistory(json.roasts);
      setCurrent(json.roasts[0] ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [site]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/storefront/roast", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site, url, range }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCurrent(json);
      setHistory((h) => [json, ...h]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const r = current?.roast;
  const path = (() => { try { return new URL(url).pathname; } catch { return url; } })();

  return (
    <div className="rounded-2xl border border-[#D8E1F1] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[#0F1B3D]"><Flame size={16} className="text-[#C2410C]" /> AI roast</h3>
          <p className="mt-0.5 text-[12px] text-[#5E6B85]">
            A blunt conversion teardown of <span className="font-mono text-[#0F1B3D]">{path}</span>: the page as shoppers get it, its photos and the store funnel.
          </p>
        </div>
        <button onClick={run} disabled={running}
          className="inline-flex items-center gap-2 rounded-full bg-[#0F1B3D] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60">
          {running ? <Loader2 size={14} className="animate-spin" /> : <Flame size={14} />}
          {running ? "Roasting… (~1 min)" : "Roast this page"}
        </button>
      </div>

      {!r ? (
        <div className="mt-4 rounded-xl border border-dashed border-[#C9D5EA] p-6 text-center text-[13px] text-[#5E6B85]">
          No roast for this site yet. Pick a page in the preview, then press <b>Roast this page</b>.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex items-start gap-4 rounded-xl bg-[#0F1B3D] p-4 text-white">
            <ScoreRing score={r.score} />
            <div className="min-w-0">
              <div className="text-[15px] font-semibold leading-snug">{r.verdict}</div>
              <div className="mt-1 truncate text-[11px] text-white/60">
                {new Date(current!.created_at).toLocaleString()} · {current!.model} · {current!.url}
              </div>
            </div>
          </div>

          <ul className="space-y-1.5">
            {r.roast.map((line, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-[#0F1B3D]"><span>🔥</span><span>{line}</span></li>
            ))}
          </ul>

          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[#5E6B85]">Where they leak</div>
            <div className="space-y-2">
              {r.leaks.map((l, i) => (
                <div key={i} className="rounded-lg border-l-4 border-[#A6472F] bg-[#FBF5F3] px-3 py-2">
                  <div className="text-[13px] font-medium text-[#0F1B3D]">{i + 1}. {l.step}</div>
                  <div className="text-[12.5px] text-[#46546F]">{l.why}</div>
                  <div className="mt-0.5 text-[11.5px] text-[#8A96AD]">Evidence: {l.evidence}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[#5E6B85]">Fix first</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[12.5px]">
                <thead className="text-left text-[11px] text-[#5E6B85]">
                  <tr><th className="py-1.5">Change</th><th>Impact</th><th>Effort</th><th>What to do</th></tr>
                </thead>
                <tbody>
                  {r.fixes.map((f, i) => (
                    <tr key={i} className="border-t border-[#EEF2FA] align-top">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-[#0F1B3D]">{f.title}</div>
                        <div className="text-[11px] text-[#8A96AD]">{f.where.replace(/_/g, " ")}</div>
                      </td>
                      <td className="py-2 pr-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${IMPACT[f.impact]}`}>{f.impact}</span></td>
                      <td className="py-2 pr-3 text-[#46546F]">{EFFORT[f.effort]}</td>
                      <td className="py-2 text-[#46546F]">{f.action}<div className="mt-0.5 text-[11px] text-[#8A96AD]">{f.evidence}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg bg-[#EFF8F1] p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[#15803D]"><ShieldCheck size={13} /> Keep</div>
              <ul className="list-disc space-y-0.5 pl-4 text-[12.5px] text-[#0F1B3D]">{r.keep.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </div>
            <div className="rounded-lg bg-[#F3F6FC] p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[#46546F]"><HelpCircle size={13} /> Can&apos;t see from here</div>
              <ul className="list-disc space-y-0.5 pl-4 text-[12.5px] text-[#0F1B3D]">{r.unknowns.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </div>
          </div>

          {history.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[#5E6B85]">
              <History size={12} /> Earlier:
              {history.map((h) => (
                <button key={h.id} onClick={() => setCurrent(h)}
                  className={`rounded-full border px-2 py-0.5 ${h.id === current?.id ? "border-[#0F1B3D] text-[#0F1B3D]" : "border-[#C9D5EA]"}`}>
                  {new Date(h.created_at).toLocaleDateString()} · {Math.round(h.roast.score)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
