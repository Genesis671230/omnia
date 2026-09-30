"use client";

/* Best creatives — the ads that turn spend into purchases, shown as their
 * creative. Ranked by pixel ROAS among ads with enough spend to trust, with
 * purchases as the tie-break; "Most bought" ranks by purchases instead. */

import { useState } from "react";
import { motion } from "framer-motion";
import { Crown, Film, Image as ImageIcon, LayoutGrid } from "lucide-react";
import type { ExplorerAd } from "@/lib/integrations/ads/meta-explorer";
import { Card, Eyebrow, Seg, compact, fmt } from "@/components/finance/dashboard-v2/overview/kit";
import { ui } from "@/components/finance/dashboard-v2/overview/ui";

const TYPE_ICON: Record<string, typeof Film> = { VIDEO: Film, PHOTO: ImageIcon, SHARE: LayoutGrid };

export function CreativesCard({ ads }: { ads: ExplorerAd[] }) {
  const [rank, setRank] = useState<"roas" | "purchases">("roas");
  const spent = ads.filter((a) => a.metrics.spend > 0);
  const minSpend = Math.max(spent.reduce((s, a) => s + a.metrics.spend, 0) * 0.01, 150);
  const list = (rank === "roas"
    ? spent.filter((a) => a.metrics.spend >= minSpend && a.metrics.purchases > 0).sort((a, b) => (b.metrics.roas ?? 0) - (a.metrics.roas ?? 0) || b.metrics.purchases - a.metrics.purchases)
    : [...spent].sort((a, b) => b.metrics.purchases - a.metrics.purchases || (b.metrics.roas ?? 0) - (a.metrics.roas ?? 0))
  ).slice(0, 8);

  return (
    <Card delay={0.16}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Best creatives</Eyebrow>
          <p className={`mt-1 ${ui.caption}`}>{rank === "roas" ? `Highest ROAS among ads that spent AED ${fmt(minSpend)}+` : "Most pixel purchases"}</p>
        </div>
        <Seg value={rank} options={[["roas", "Best ROAS"], ["purchases", "Most bought"]]} onChange={setRank} />
      </div>
      {list.length === 0 ? (
        <p className={`mt-4 ${ui.caption}`}>No ad has enough spend and purchases in this period to rank.</p>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {list.map((a, i) => {
            console.log(a);
            const Icon = TYPE_ICON[a.creative.type] ?? ImageIcon;
            const img = a.creative.imageUrl || a.creative.thumbnailUrl;
            return (
              <motion.article key={a.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }}
                className="overflow-hidden rounded-3xl bg-slate-50 ring-1 ring-slate-100">
                <div className="relative aspect-square bg-slate-200">
                  {img && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                  )}
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] text-slate-700 backdrop-blur"><Icon size={11} />{a.creative.type ? a.creative.type.toLowerCase() : "ad"}</span>
                  {i === 0 && <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] text-white"><Crown size={11} />Best</span>}
                  <span className={`absolute bottom-3 left-3 rounded-full px-2 py-0.5 text-[11px] ${a.status === "ACTIVE" ? "bg-emerald-500 text-white" : "bg-white/90 text-slate-600"}`}>{a.status === "ACTIVE" ? "Running" : a.status.toLowerCase().replace(/_/g, " ")}</span>
                </div>
                <div className="p-4">
                  <p className="truncate text-[13.5px] font-medium text-slate-900" title={a.name}>{a.name}</p>
                  {(a.creative.title || a.creative.body) && <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-slate-500" dir="auto">{a.creative.title || a.creative.body}</p>}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <Stat label="ROAS" value={a.metrics.roas != null ? `${a.metrics.roas.toFixed(1)}×` : "—"} />
                    <Stat label="Bought" value={fmt(a.metrics.purchases)} />
                    <Stat label="Spend" value={compact(a.metrics.spend)} />
                  </div>
                  <p className="mt-2 text-center text-[11px] text-slate-400">CTR {a.metrics.ctr ?? "—"}% · {fmt(a.metrics.addToCart)} carts · AED {fmt(a.metrics.cpa ?? 0)}/purchase</p>
                </div>
              </motion.article>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white px-1 py-1.5">
      <p className="text-[14px] font-medium tabular-nums text-slate-900">{value}</p>
      <p className="text-[10.5px] text-slate-400">{label}</p>
    </div>
  );
}
