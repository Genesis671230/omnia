"use client";

/* Tracking — is the data trustworthy? Each Meta pixel with when it last fired
 * (a pixel silent for a day means pixel purchases are undercounted), and the
 * tags each storefront actually loads. */

import { CheckCircle2, CircleDashed } from "lucide-react";
import type { PixelStatus, SiteTags } from "@/lib/integrations/ads/tracking-check";
import { Card, Eyebrow } from "@/components/finance/dashboard-v2/overview/kit";
import { ui } from "@/components/finance/dashboard-v2/overview/ui";

const SITE_LABEL: Record<string, string> = { MAIN: "omniastores.com", UAE: "Shopify UAE", KSA: "Shopify KSA", WA: "WhatsApp store" };

function fired(p: PixelStatus): { text: string; ok: boolean } {
  if (p.hoursSinceFired == null) return { text: "never fired", ok: false };
  if (p.hoursSinceFired < 24) return { text: `fired ${p.hoursSinceFired}h ago`, ok: true };
  const days = Math.round(p.hoursSinceFired / 24);
  return { text: days > 365 ? `silent since ${p.lastFired?.slice(0, 4)}` : `silent ${days} days`, ok: false };
}

export function TrackingCard({ tracking }: { tracking: { pixels: PixelStatus[]; sites: SiteTags[] } }) {
  const live = tracking.pixels.filter((p) => fired(p).ok);
  return (
    <Card delay={0.2}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Tracking</Eyebrow>
        <span className={ui.hint}>{live.length} live Meta pixel{live.length === 1 ? "" : "s"} · checked every 6 hours</span>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-[12.5px] font-medium text-slate-700">Meta pixels</p>
          <ul className="space-y-1.5">
            {tracking.pixels.map((p) => {
              const f = fired(p);
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-[12.5px]">
                  <span className="flex min-w-0 items-center gap-2">
                    {f.ok ? <CheckCircle2 size={14} className="shrink-0 text-emerald-600" /> : <CircleDashed size={14} className="shrink-0 text-slate-400" />}
                    <span className="truncate text-slate-800">{p.name}</span>
                  </span>
                  <span className={`shrink-0 ${f.ok ? "text-emerald-700" : "text-slate-400"}`}>{f.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-[12.5px] font-medium text-slate-700">Tags on each site</p>
          <ul className="space-y-1.5">
            {tracking.sites.map((s) => (
              <li key={s.site} className="rounded-xl bg-slate-50 px-3 py-2 text-[12.5px]">
                <span className="text-slate-800">{SITE_LABEL[s.site] ?? s.site}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {s.error ? <span className="text-rose-600">couldn&apos;t load the site</span>
                    : s.tags.length === 0 ? <span className="text-slate-400">no tags found</span>
                    : s.tags.map((t) => <span key={t} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">{t}</span>)}
                </span>
              </li>
            ))}
          </ul>
          <p className={`mt-2 ${ui.hint}`}>Shopify stores that track through Customer Events (the Facebook &amp; Instagram app) show only &ldquo;Shopify customer events&rdquo; — their pixel runs inside it.</p>
        </div>
      </div>
    </Card>
  );
}
