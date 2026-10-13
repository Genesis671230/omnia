"use client";

// Storefronts: where shoppers leak on omniastores.com / .ae / sa.omniastores.ae.
// Session funnel drawn as a funnel with the leak at every step, product
// landing pages ranked by visitors lost before the cart (real product photos
// from the public catalogue), a live preview of any page and an AI roast of it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Globe, Loader2, Monitor, RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { RoastCard } from "./roast-card";

type Step = { key: string; label: string; count: number; ofTotal: number; lost: number; dropRate: number };
type Product = { handle: string; title: string; price: number; compareAt: number | null; image: string | null; images: number; url: string };
type Leak = { handle: string; path: string; sessions: number; addedToCart: number; completed: number; cartRate: number; conversion: number; bounced: number; product: Product | null };
type Payload = {
  site: { code: string; label: string; origin: string; storeCode: string; currency: string };
  range: { key: string; from: string; to: string };
  funnel: { status: "ok"; steps: Step[]; worst: Step | null; sources: { source: string; sessions: number; completed: number }[] } | { status: string; message: string };
  devices: { device: string; sessions: number; addedToCart: number; completed: number }[];
  pageTypes: { type: string; sessions: number; addedToCart: number; completed: number }[];
  productLeaks: Leak[];
  detailStatus: { status: string; message?: string };
  catalogue: Product[];
  catalogueError: string | null;
};

const SITES = [
  { code: "com", label: "omniastores.com", flag: "🌍" },
  { code: "ae", label: "omniastores.ae", flag: "🇦🇪" },
  { code: "sa", label: "sa.omniastores.ae", flag: "🇸🇦" },
];
const RANGES = [["1d", "1 day"],["7d", "7 days"], ["14d", "14 days"], ["30d", "30 days"], ["mtd", "Month to date"]] as const;

const n0 = (v: number) => new Intl.NumberFormat("en-AE").format(Math.round(v));
const pc = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;
const money = (v: number, cur: string) => `${cur} ${new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }).format(v)}`;

/* ── Funnel diagram ─────────────────────────────────────────────────────── */

function FunnelDiagram({ steps, worstKey }: { steps: Step[]; worstKey?: string }) {
  const W = 620, rowH = 64, gap = 14, left = 20, maxW = 360, minW = 70;
  const top = steps[0]?.count || 1;
  const widthOf = (c: number) => Math.max(minW, (Math.sqrt(c / top) || 0) * maxW);
  const H = steps.length * (rowH + gap);
  const cx = left + maxW / 2;
  const fills = ["#1E3A8A", "#1D4ED8", "#3B82F6", "#15803D"];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Store funnel with drop-off at each step">
      {steps.map((s, i) => {
        const y = i * (rowH + gap);
        const w1 = widthOf(s.count);
        const w2 = i < steps.length - 1 ? widthOf(steps[i + 1].count) : w1 * 0.9;
        const pts = `${cx - w1 / 2},${y} ${cx + w1 / 2},${y} ${cx + w2 / 2},${y + rowH} ${cx - w2 / 2},${y + rowH}`;
        const next = steps[i + 1];
        const worst = next && next.key === worstKey;
        return (
          <g key={s.key}>
            <polygon points={pts} fill={fills[i] ?? "#1D4ED8"} opacity={0.92} />
            <text x={cx} y={y + 27} textAnchor="middle" fill="#fff" fontSize="15" fontWeight="700">{n0(s.count)}</text>
            <text x={cx} y={y + 45} textAnchor="middle" fill="#fff" fontSize="11.5" opacity={0.85}>
              {s.label}{i > 0 ? ` · ${pc(s.ofTotal)}` : ""}
            </text>
            {next && (
              <g>
                <path d={`M ${cx + w2 / 2 + 6} ${y + rowH - 4} C ${cx + maxW / 2 + 30} ${y + rowH + 2}, ${cx + maxW / 2 + 40} ${y + rowH + gap / 2}, ${cx + maxW / 2 + 60} ${y + rowH + gap / 2}`}
                  fill="none" stroke={worst ? "#A6472F" : "#D8A89A"} strokeWidth={worst ? 2.5 : 1.5} markerEnd={worst ? "url(#arrowWorst)" : "url(#arrow)"} />
                <text x={cx + maxW / 2 + 68} y={y + rowH + gap / 2 - 4} fill={worst ? "#A6472F" : "#8A5A4F"} fontSize="13" fontWeight={worst ? 700 : 600}>
                  −{n0(next.lost)} left ({pc(next.dropRate)})
                </text>
                <text x={cx + maxW / 2 + 68} y={y + rowH + gap / 2 + 12} fill="#8A96AD" fontSize="11">
                  {worst ? "biggest leak · " : ""}{s.label.toLowerCase()} → {next.label.toLowerCase()}
                </text>
              </g>
            )}
          </g>
        );
      })}
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#D8A89A" /></marker>
        <marker id="arrowWorst" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#A6472F" /></marker>
      </defs>
    </svg>
  );
}

function RateBar({ label, sessions, rate, sub }: { label: string; sessions: number; rate: number; sub: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="capitalize text-[#0F1B3D]">{label}</span>
        <span className="text-[#5E6B85]">{n0(sessions)} visits · <b className="text-[#0F1B3D]">{pc(rate)}</b> {sub}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-[#EEF2FA]"><div className="h-2 rounded-full bg-[#1D4ED8]" style={{ width: `${Math.min(rate * 100, 100)}%` }} /></div>
    </div>
  );
}

/* ── Panel ──────────────────────────────────────────────────────────────── */

export function StorefrontPanel() {
  const [site, setSite] = useState("ae");
  const [range, setRange] = useState("30d");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState("");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [frameLoading, setFrameLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/storefront?site=${site}&range=${range}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      setPreviewUrl((u) => (u && new URL(u).origin === json.site.origin ? u : (json.productLeaks[0]?.product?.url ?? json.catalogue[0]?.url ?? json.site.origin)));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [site, range]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (previewUrl) setFrameLoading(true); }, [previewUrl]);

  const funnelOk = data?.funnel.status === "ok" ? data.funnel : null;
  const path = useMemo(() => { try { return new URL(previewUrl).pathname; } catch { return "/"; } }, [previewUrl]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#D8E1F1] bg-white p-3">
        <div className="flex flex-wrap gap-1.5">
          {SITES.map((s) => (
            <button key={s.code} onClick={() => { setSite(s.code); setPreviewUrl(""); }}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] ${site === s.code ? "bg-[#0F1B3D] text-white" : "text-[#46546F] hover:bg-[#F3F6FC]"}`}>
              <span>{s.flag}</span>{s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select value={range} onChange={(e) => setRange(e.target.value)}
            className="rounded-full border border-[#C9D5EA] bg-white px-3 py-1.5 text-[12.5px] text-[#0F1B3D]">
            {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button onClick={load} className="rounded-full border border-[#C9D5EA] bg-white p-2 text-[#46546F]" title="Reload">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-[#C9D5EA] bg-white p-12 text-[14px] text-[#5E6B85]">
          <Loader2 size={18} className="animate-spin" /> Reading the storefront…
        </div>
      ) : data && (
        <>
          <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
            {/* Funnel */}
            <div className="rounded-2xl border border-[#D8E1F1] bg-white p-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-[15px] font-semibold text-[#0F1B3D]">Where shoppers leak · {data.site.label}</h3>
                <span className="text-[11.5px] text-[#5E6B85]">{data.range.from} → {data.range.to} · Shopify sessions</span>
              </div>
              {funnelOk ? (
                <>
                  <FunnelDiagram steps={funnelOk.steps} worstKey={funnelOk.worst?.key} />
                  {funnelOk.worst && (
                    <div className="mt-3 rounded-lg bg-[#FBF5F3] px-3 py-2 text-[12.5px] text-[#0F1B3D]">
                      <b className="text-[#A6472F]">Biggest leak:</b> {n0(funnelOk.worst.lost)} visitors ({pc(funnelOk.worst.dropRate)}) never got to &ldquo;{funnelOk.worst.label.toLowerCase()}&rdquo;.
                      Overall {pc(funnelOk.steps[3].ofTotal)} of visits buy.
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-xl border border-[#E8C9BE] bg-[#F9ECE7] p-4 text-[12.5px] leading-relaxed text-[#A6472F]">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} /> No session funnel for {data.site.label} (Shopify store {data.site.storeCode})</div>
                  {"message" in data.funnel ? data.funnel.message : ""}
                  <div className="mt-2 text-[#46546F]">The live preview, product photos and AI roast below still work. The roast judges the page on its own until the funnel is connected.</div>
                </div>
              )}
            </div>

            {/* Device + page type + sources */}
            <div className="space-y-5">
              <div className="rounded-2xl border border-[#D8E1F1] bg-white p-5">
                <h3 className="mb-3 text-[14px] font-semibold text-[#0F1B3D]">Add-to-cart rate by device</h3>
                {data.devices.length ? (
                  <div className="space-y-3">
                    {data.devices.map((d) => <RateBar key={d.device} label={d.device} sessions={d.sessions} rate={d.sessions ? d.addedToCart / d.sessions : 0} sub="add to cart" />)}
                  </div>
                ) : <div className="text-[12.5px] text-[#8A96AD]">Needs the session funnel (see left).</div>}
              </div>
              <div className="rounded-2xl border border-[#D8E1F1] bg-white p-5">
                <h3 className="mb-3 text-[14px] font-semibold text-[#0F1B3D]">Conversion by landing page type</h3>
                {data.pageTypes.length ? (
                  <div className="space-y-3">
                    {data.pageTypes.slice(0, 6).map((t) => <RateBar key={t.type} label={t.type} sessions={t.sessions} rate={t.sessions ? t.completed / t.sessions : 0} sub="buy" />)}
                  </div>
                ) : <div className="text-[12.5px] text-[#8A96AD]">Needs the session funnel (see left).</div>}
                {funnelOk && funnelOk.sources.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5 text-[11.5px]">
                    {funnelOk.sources.map((s) => (
                      <span key={s.source} className="rounded-full bg-[#F3F6FC] px-2.5 py-1 text-[#46546F]">
                        {s.source}: {n0(s.sessions)} → {n0(s.completed)} buy
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Product page leaks */}
          <div className="rounded-2xl border border-[#D8E1F1] bg-white p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-[15px] font-semibold text-[#0F1B3D]">
                {data.productLeaks.length ? "Product pages losing the most visitors" : "Product pages"}
              </h3>
              <span className="text-[11.5px] text-[#5E6B85]">
                {data.productLeaks.length ? "landed on the product, never added to cart" : "live catalogue — pick one to preview and roast"}
              </span>
            </div>
            {data.productLeaks.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-[12.5px]">
                  <thead className="text-left text-[11px] text-[#5E6B85]">
                    <tr><th className="py-1.5">Product</th><th className="text-right">Visits</th><th className="text-right">Left without cart</th><th className="text-right">Add-to-cart</th><th className="text-right">Bought</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.productLeaks.map((l) => {
                      const url = l.product?.url ?? `${data.site.origin}${l.path}`;
                      return (
                        <tr key={l.handle} className={`border-t border-[#EEF2FA] ${url === previewUrl ? "bg-[#F3F6FC]" : ""}`}>
                          <td className="py-2">
                            <div className="flex items-center gap-3">
                              {l.product?.image
                                ? <img src={l.product.image} alt={l.product.title} className="h-12 w-12 flex-shrink-0 rounded-lg object-cover" loading="lazy" />
                                : <div className="h-12 w-12 flex-shrink-0 rounded-lg bg-[#EEF2FA]" />}
                              <div className="min-w-0">
                                <div className="max-w-[340px] truncate font-medium text-[#0F1B3D]">{l.product?.title ?? l.handle}</div>
                                <div className="text-[11px] text-[#8A96AD]">
                                  {l.product ? money(l.product.price, data.site.currency) : "not in catalogue — unpublished or redirected?"}
                                  {l.product?.compareAt ? <s className="ml-1">{money(l.product.compareAt, data.site.currency)}</s> : null}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="text-right text-[#0F1B3D]">{n0(l.sessions)}</td>
                          <td className="text-right font-semibold text-[#A6472F]">{n0(l.bounced)}</td>
                          <td className="text-right">{pc(l.cartRate)}</td>
                          <td className="text-right">{pc(l.conversion)}</td>
                          <td className="pl-3 text-right">
                            <button onClick={() => setPreviewUrl(url)} className="rounded-full border border-[#C9D5EA] px-2.5 py-1 text-[11.5px] text-[#0F1B3D]">Inspect</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : data.catalogue.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {data.catalogue.slice(0, 18).map((p) => (
                  <button key={p.handle} onClick={() => setPreviewUrl(p.url)}
                    className={`overflow-hidden rounded-xl border text-left transition ${p.url === previewUrl ? "border-[#0F1B3D] ring-2 ring-[#0F1B3D]/15" : "border-[#D8E1F1] hover:border-[#9AAACA]"}`}>
                    {p.image ? <img src={p.image} alt={p.title} className="aspect-square w-full object-cover" loading="lazy" /> : <div className="aspect-square w-full bg-[#EEF2FA]" />}
                    <div className="p-2">
                      <div className="line-clamp-2 text-[11.5px] leading-snug text-[#0F1B3D]">{p.title}</div>
                      <div className="mt-0.5 text-[11px] text-[#5E6B85]">
                        {money(p.price, data.site.currency)}{p.compareAt ? <s className="ml-1 text-[#8A96AD]">{money(p.compareAt, data.site.currency)}</s> : null}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-[12.5px] text-[#A6472F]">{data.catalogueError ?? "No products found."}</div>
            )}
            {data.productLeaks.length === 0 && data.detailStatus.status !== "ok" && (
              <div className="mt-3 text-[11.5px] text-[#8A96AD]">Per-product leak figures need the store&apos;s Shopify read_reports scope. Until then this shows the live catalogue.</div>
            )}
          </div>

          {/* Preview + roast */}
          <div className="grid gap-5 xl:grid-cols-[auto_1fr]">
            <div className="rounded-2xl border border-[#D8E1F1] bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-[#F3F6FC] px-3 py-1.5 text-[12px] text-[#46546F]">
                  <Globe size={12} className="flex-shrink-0" />
                  <span className="truncate">{data.site.label}<b className="font-mono text-[#0F1B3D]">{path}</b></span>
                </div>
                <div className="inline-flex rounded-full border border-[#C9D5EA] p-0.5">
                  <button onClick={() => setDevice("mobile")} className={`rounded-full p-1.5 ${device === "mobile" ? "bg-[#0F1B3D] text-white" : "text-[#46546F]"}`} title="Mobile"><Smartphone size={13} /></button>
                  <button onClick={() => setDevice("desktop")} className={`rounded-full p-1.5 ${device === "desktop" ? "bg-[#0F1B3D] text-white" : "text-[#46546F]"}`} title="Desktop"><Monitor size={13} /></button>
                </div>
                <a href={previewUrl} target="_blank" rel="noreferrer" className="rounded-full border border-[#C9D5EA] p-1.5 text-[#46546F]" title="Open the real page"><ExternalLink size={13} /></a>
              </div>
              <div className={`relative mx-auto overflow-hidden bg-[#F3F6FC] ${device === "mobile" ? "h-[760px] w-[390px] rounded-[36px] border-[10px] border-[#0F1B3D]" : "h-[720px] w-full min-w-[640px] rounded-xl border border-[#D8E1F1] xl:w-[900px]"}`}>
                {frameLoading && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-white/80 text-[13px] text-[#5E6B85]">
                    <Loader2 size={16} className="animate-spin" /> Loading page…
                  </div>
                )}
                {previewUrl && (
                  <iframe key={previewUrl} title={`Preview of ${previewUrl}`} src={`/api/storefront/preview?url=${encodeURIComponent(previewUrl)}`}
                    className="h-full w-full bg-white" sandbox="allow-scripts" onLoad={() => setFrameLoading(false)} />
                )}
              </div>
              <p className="mt-2 max-w-[390px] text-[11px] leading-relaxed text-[#8A96AD] xl:max-w-none">
                Static snapshot: the store blocks framing, so the page is served through the dashboard with its scripts removed. Pixels don&apos;t fire and nothing is added to a cart. Links stay inside the preview.
              </p>
            </div>
            <RoastCard key={`${data.site.code}`} site={data.site.code} url={previewUrl || data.site.origin} range={range} />
          </div>
        </>
      )}
    </div>
  );
}
