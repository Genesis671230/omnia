"use client";

/* Campaigns → ad sets → ads, one table. Running only by default (what is
 * spending now); "All with delivery" adds everything that spent in the range.
 * ROAS is coloured only at the ends: ≥ 3× reads green, < 1× reads red. */

import { Fragment, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AdMetrics, ExplorerAd, ExplorerAdSet, ExplorerCampaign } from "@/lib/integrations/ads/meta-explorer";
import { Card, Eyebrow, Seg, compact, fmt } from "@/components/finance/dashboard-v2/overview/kit";
import { ui } from "@/components/finance/dashboard-v2/overview/ui";
import type { ExplorerResponse } from "./ads-explorer";

const daysSince = (iso: string | null) => (iso ? Math.max(Math.floor((Date.now() - Date.parse(iso)) / 86_400_000), 0) : null);
const roasTone = (r: number | null) => (r == null ? "text-slate-400" : r >= 3 ? "text-emerald-700" : r < 1 ? "text-rose-600" : "text-slate-900");

function StatusDot({ status }: { status: string }) {
  const on = status === "ACTIVE";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${on ? "bg-emerald-500" : "bg-slate-300"}`} title={status.toLowerCase().replace(/_/g, " ")} />;
}

function Cells({ m, budget }: { m: AdMetrics; budget?: number | null }) {
  return (
    <>
      <td className={`${ui.td} text-right text-slate-500`}>{budget != null ? `AED ${fmt(budget)}` : "—"}</td>
      <td className={`${ui.td} text-right font-medium text-slate-900`} title={`AED ${fmt(m.spend, 2)}`}>{compact(m.spend)}</td>
      <td className={`${ui.td} text-right text-slate-600`}>{m.ctr != null ? `${m.ctr}%` : "—"}</td>
      <td className={`${ui.td} text-right text-slate-600`}>{m.cpc != null ? m.cpc.toFixed(2) : "—"}</td>
      <td className={`${ui.td} text-right text-slate-600`}>{fmt(m.addToCart)}</td>
      <td className={`${ui.td} text-right text-slate-900`}>{fmt(m.purchases)}</td>
      <td className={`${ui.td} text-right text-slate-600`}>{m.cpa != null ? fmt(m.cpa) : "—"}</td>
      <td className={`${ui.td} text-right font-medium ${roasTone(m.roas)}`}>{m.roas != null ? `${m.roas.toFixed(2)}×` : "—"}</td>
    </>
  );
}

export function CampaignTree({ data }: { data: ExplorerResponse }) {
  const [scope, setScope] = useState<"running" | "all">("running");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const { campaigns, adsetsOf, adsOf } = useMemo(() => {
    const keep = (status: string, spend: number) => (scope === "running" ? status === "ACTIVE" : status === "ACTIVE" || spend > 0);
    const adsOf = new Map<string, ExplorerAd[]>();
    for (const a of data.ads) if (keep(a.status, a.metrics.spend)) adsOf.set(a.adsetId, [...(adsOf.get(a.adsetId) ?? []), a]);
    const adsetsOf = new Map<string, ExplorerAdSet[]>();
    for (const s of data.adsets) if (keep(s.status, s.metrics.spend) || adsOf.has(s.id)) adsetsOf.set(s.campaignId, [...(adsetsOf.get(s.campaignId) ?? []), s]);
    const campaigns: ExplorerCampaign[] = data.campaigns.filter((c) => keep(c.status, c.metrics.spend) || adsetsOf.has(c.id));
    return { campaigns, adsetsOf, adsOf };
  }, [data, scope]);

  return (
    <Card delay={0.18}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Campaigns</Eyebrow>
          <p className={`mt-1 ${ui.caption}`}>{campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} · open one for its ad sets, and an ad set for its ads</p>
        </div>
        <Seg value={scope} options={[["running", "Running"], ["all", "All with delivery"]]} onChange={setScope} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] text-[13px]">
          <thead>
            <tr className="text-left">
              <th className={ui.th}>Name</th>
              <th className={`${ui.th} text-right`}>Budget / day</th>
              <th className={`${ui.th} text-right`}>Spend</th>
              <th className={`${ui.th} text-right`}>CTR</th>
              <th className={`${ui.th} text-right`}>CPC</th>
              <th className={`${ui.th} text-right`}>Carts</th>
              <th className={`${ui.th} text-right`}>Purchases</th>
              <th className={`${ui.th} text-right`}>Cost / purchase</th>
              <th className={`${ui.th} text-right`}>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const cOpen = open.has(c.id);
              const age = daysSince(c.startTime);
              return (
                <Fragment key={c.id}>
                  <tr className="cursor-pointer hover:bg-slate-50/70" onClick={() => toggle(c.id)}>
                    <td className={ui.td}>
                      <div className="flex items-center gap-2.5">
                        <ChevronRight size={14} className={`shrink-0 text-slate-400 transition-transform ${cOpen ? "rotate-90" : ""}`} />
                        <StatusDot status={c.status} />
                        <span className="min-w-0">
                          <span className="block max-w-[360px] truncate font-medium text-slate-900" title={c.name}>{c.name}</span>
                          <span className="block text-[11.5px] text-slate-400">
                            {c.objective.replace("OUTCOME_", "").toLowerCase()}{age != null ? ` · running ${age} day${age === 1 ? "" : "s"}` : ""} · {c.store === "WOO" ? "omniastores.com" : c.store}
                          </span>
                        </span>
                      </div>
                    </td>
                    <Cells m={c.metrics} budget={c.dailyBudget} />
                  </tr>
                  {cOpen && (adsetsOf.get(c.id) ?? []).map((s) => {
                    const sOpen = open.has(s.id);
                    return (
                      <Fragment key={s.id}>
                        <tr className="cursor-pointer bg-slate-50/40 hover:bg-slate-50" onClick={() => toggle(s.id)}>
                          <td className={ui.td}>
                            <div className="flex items-center gap-2.5 pl-6">
                              <ChevronRight size={13} className={`shrink-0 text-slate-400 transition-transform ${sOpen ? "rotate-90" : ""}`} />
                              <StatusDot status={s.status} />
                              <span className="min-w-0">
                                <span className="block max-w-[330px] truncate text-slate-900" title={s.name}>{s.name}</span>
                                <span className="block text-[11.5px] text-slate-400">{s.audience || "—"}{s.optimizationGoal ? ` · optimising for ${s.optimizationGoal.toLowerCase().replace(/_/g, " ")}` : ""}</span>
                              </span>
                            </div>
                          </td>
                          <Cells m={s.metrics} budget={s.dailyBudget} />
                        </tr>
                        {sOpen && (adsOf.get(s.id) ?? []).map((a) => (
                          <tr key={a.id} className="bg-slate-50/20">
                            <td className={ui.td}>
                              <div className="flex items-center gap-2.5 pl-14">
                                <span className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                                  {(a.creative.thumbnailUrl || a.creative.imageUrl) && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={a.creative.thumbnailUrl || a.creative.imageUrl || ""} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                                  )}
                                </span>
                                <StatusDot status={a.status} />
                                <span className="min-w-0">
                                  <span className="block max-w-[300px] truncate text-slate-700" title={a.name}>{a.name}</span>
                                  <span className="block text-[11.5px] text-slate-400">{a.creative.type.toLowerCase() || "ad"}{a.creative.cta ? ` · ${a.creative.cta.toLowerCase().replace(/_/g, " ")}` : ""}</span>
                                </span>
                              </div>
                            </td>
                            <Cells m={a.metrics} />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
