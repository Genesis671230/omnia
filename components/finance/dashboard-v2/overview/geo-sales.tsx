"use client";

/* Where the sales come from — a map of the range's counted sales by shipping
   country, next to the ranked list that carries every number.

   Map:   one blue, darker = more sales (sqrt scale so the UAE/KSA don't wash
          the rest out). Countries too small to hover at this zoom (Qatar,
          Bahrain, Kuwait) get a marker at their centre. Labels are placed
          biggest first and never overlap. Region view fits the Gulf plus any
          country with ≥ 2% of sales; World shows everything.
   Click: a country (on the map or in the list) zooms to it and opens its
          cities and store split. Click again or "All countries" to go back.

   Data:  /api/dashboard/geo (lib/orders/sales-by-country.ts) — same orders
          and totals as the sales ledger for the range.
   Shapes: /geo/countries-50m.json — Natural Earth 1:50m via world-atlas, ids
          rewritten to ISO-2 so they join orders.country directly. */

import { AnimatePresence, animate, motion } from "framer-motion";
import { ArrowLeft, Loader2, MapPin } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoArea, geoEqualEarth, geoGraticule10, geoMercator, geoPath, type GeoProjection } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { CountrySales, SalesByCountry } from "@/lib/orders/sales-by-country";
import { Eyebrow, Seg, aed, compact, fmt, pct } from "./kit";
import { ui } from "./ui";

/* ── constants ─────────────────────────────────────────────────────────── */

const W = 880;
const H = 470;
const GULF = ["SA", "AE", "OM", "QA", "KW", "BH"];
const INK = "#0F172A";
const LAND = "#E4E9F1";
const OCEAN = "#F6F8FC";
const LOW = [214, 228, 253] as const; // #D6E4FD
const HIGH = [29, 78, 216] as const; //  #1D4ED8
const EASE = [0.22, 1, 0.36, 1] as const;

type Shape = Feature<Polygon | MultiPolygon, { name: string }> & { id?: string };
type View = "region" | "world";
type Zoom = { k: number; x: number; y: number };
const IDENTITY: Zoom = { k: 1, x: 0, y: 0 };

/* ── helpers ───────────────────────────────────────────────────────────── */

let worldPromise: Promise<Shape[]> | null = null;
function loadWorld(): Promise<Shape[]> {
  worldPromise ??= fetch("/geo/countries-50m.json")
    .then((r) => {
      if (!r.ok) throw new Error(`map shapes failed to load (${r.status})`);
      return r.json();
    })
    .then((topo: Topology<{ countries: GeometryCollection<{ name: string }> }>) =>
      (feature(topo, topo.objects.countries) as FeatureCollection<Polygon | MultiPolygon, { name: string }>).features as Shape[],
    )
    .catch((e) => {
      worldPromise = null;
      throw e;
    });
  return worldPromise;
}

const displayNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
const SHORT: Record<string, string> = { AE: "UAE", SA: "Saudi Arabia", GB: "UK", US: "USA" };
export function countryName(code: string, short = false): string {
  if (short && SHORT[code]) return SHORT[code];
  try {
    return displayNames?.of(code) ?? code;
  } catch {
    return code;
  }
}
export const flag = (code: string) =>
  /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";

/** The biggest polygon of a country — so France centres on France, not
 *  halfway to French Guiana, and fits don't stretch to overseas islands. */
function mainland(f: Shape): Shape {
  if (f.geometry.type !== "MultiPolygon") return f;
  let best = f.geometry.coordinates[0];
  let bestArea = -1;
  for (const coords of f.geometry.coordinates) {
    const a = geoArea({ type: "Polygon", coordinates: coords });
    if (a > bestArea) { bestArea = a; best = coords; }
  }
  return { ...f, geometry: { type: "Polygon", coordinates: best } };
}

function shade(t: number): string {
  const c = LOW.map((lo, i) => Math.round(lo + (HIGH[i] - lo) * Math.min(Math.max(t, 0), 1)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

type Box = { x: number; y: number; w: number; h: number };
// 6px of air between labels
const overlaps = (a: Box, b: Box, m = 6) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

async function getGeo(from: string, to: string): Promise<SalesByCountry> {
  const res = await fetch(`/api/dashboard/geo?from=${from}&to=${to}`, { cache: "no-store" });
  if (!(res.headers.get("content-type") || "").includes("application/json")) throw new Error(`Unexpected response (${res.status}) — session may have expired`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

/* ── map ───────────────────────────────────────────────────────────────── */

function SalesMap({
  shapes, data, view, hover, selected, onHover, onSelect,
}: {
  shapes: Shape[];
  data: SalesByCountry;
  view: View;
  hover: string | null;
  selected: string | null;
  onHover: (c: string | null) => void;
  onSelect: (c: string | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; flipX: boolean } | null>(null);
  const [zoom, setZoom] = useState<Zoom>(IDENTITY);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const byCode = useMemo(() => new Map(data.countries.map((c) => [c.country, c])), [data]);
  const max = data.countries[0]?.soldAed || 1;

  const visible = useMemo(() => shapes.filter((s) => s.id !== "AQ"), [shapes]);

  const { projection, path } = useMemo(() => {
    let p: GeoProjection;
    if (view === "world") {
      p = geoEqualEarth().fitExtent([[12, 12], [W - 12, H - 12]], { type: "Sphere" });
    } else {
      const focus = new Set([...GULF, ...data.countries.filter((c) => c.share >= 0.02).map((c) => c.country)]);
      const fit = visible.filter((s) => s.id && focus.has(s.id)).map(mainland);
      p = geoMercator().fitExtent([[40, 36], [W - 40, H - 36]], { type: "FeatureCollection", features: fit });
    }
    return { projection: p, path: geoPath(p) };
  }, [view, visible, data]);

  // per-country geometry in base (un-zoomed) screen space
  const geo = useMemo(() => {
    const m = new Map<string, { d: string; c: [number, number]; area: number; bounds: [[number, number], [number, number]] }>();
    for (const s of visible) {
      const d = path(s);
      if (!d) continue;
      const main = mainland(s);
      m.set(s.id ?? s.properties.name, { d, c: path.centroid(main), area: path.area(main), bounds: path.bounds(main) });
    }
    return m;
  }, [visible, path]);

  const graticule = useMemo(() => (view === "world" ? path(geoGraticule10()) : null), [view, path]);
  const sphere = useMemo(() => (view === "world" ? path({ type: "Sphere" }) : null), [view, path]);

  // zoom to the selected country (animated), back to the whole view otherwise
  useEffect(() => {
    let target = IDENTITY;
    const g = selected ? geo.get(selected) : null;
    if (g) {
      const [[x0, y0], [x1, y1]] = g.bounds;
      const k = Math.min(Math.max(Math.min((W * 0.55) / Math.max(x1 - x0, 1), (H * 0.6) / Math.max(y1 - y0, 1)), 1), 14);
      target = { k, x: W / 2 - k * (x0 + x1) / 2, y: H / 2 - k * (y0 + y1) / 2 };
    }
    const from = zoomRef.current;
    const ctl = animate(0, 1, {
      duration: 0.75,
      ease: EASE,
      onUpdate: (t) => setZoom({ k: from.k + (target.k - from.k) * t, x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t }),
    });
    return () => ctl.stop();
  }, [selected, geo]);

  // reset zoom instantly when the projection changes
  useEffect(() => { setZoom(IDENTITY); }, [projection]);

  const toScreen = ([x, y]: [number, number]): [number, number] => [x * zoom.k + zoom.x, y * zoom.k + zoom.y];

  // the base map never changes while zooming — memo it so a frame only moves one <g>
  const land = useMemo(
    () =>
      visible.map((s) => {
        const code = s.id ?? s.properties.name;
        const g = geo.get(code);
        if (!g) return null;
        const sales = s.id ? byCode.get(s.id) : undefined;
        return (
          <path
            key={code}
            d={g.d}
            fill={sales ? shade(Math.sqrt(sales.soldAed / max)) : LAND}
            stroke="#FFFFFF"
            strokeWidth={0.7}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            className={sales ? "cursor-pointer transition-[fill] duration-300" : undefined}
            onMouseEnter={() => onHover(sales ? s.id! : null)}
            onClick={sales ? () => onSelect(s.id!) : undefined}
          />
        );
      }),
    [visible, geo, byCode, max, onHover, onSelect],
  );

  // markers + labels in screen space, so text stays crisp at any zoom
  const anchors = data.countries
    .map((c) => {
      const g = geo.get(c.country);
      if (!g) return null;
      const [x, y] = toScreen(g.c);
      return { c, x, y, tiny: g.area * zoom.k * zoom.k < 140 };
    })
    .filter((a): a is { c: CountrySales; x: number; y: number; tiny: boolean } => !!a && a.x > -20 && a.x < W + 20 && a.y > -20 && a.y < H + 20);

  const labels: { c: CountrySales; box: Box; ax: number; ay: number; leader: boolean }[] = [];
  const taken: Box[] = anchors.map((a) => ({ x: a.x - 6, y: a.y - 6, w: 12, h: 12 }));
  for (const a of anchors.slice(0, selected ? 12 : 7)) {
    const name = countryName(a.c.country, true);
    // ~6.6px per char at 11px semibold, ~6px at 10.5px regular (system UI font)
    const w = Math.ceil(Math.max(name.length * 6.4, `AED ${compact(a.c.soldAed)} · ${pct(a.c.share)}`.length * 5.7) + 22);
    const h = 36;
    const tries: [number, number, boolean][] = [
      [a.x - w / 2, a.y - h - 10, false],
      [a.x - w / 2, a.y + 10, false],
      [a.x + 12, a.y - h / 2, false],
      [a.x - w - 12, a.y - h / 2, false],
      [a.x + 18, a.y - h - 18, true],
      [a.x - w - 18, a.y + 18, true],
    ];
    for (const [x, y, leader] of tries) {
      const box = { x, y, w, h };
      if (x < 4 || y < 4 || x + w > W - 4 || y + h > H - 4) continue;
      if (taken.some((t) => overlaps(t, box))) continue;
      taken.push(box);
      labels.push({ c: a.c, box, ax: a.x, ay: a.y, leader });
      break;
    }
  }

  const tipData = hover ? byCode.get(hover) : undefined;

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseMove={(e) => {
        const r = wrapRef.current!.getBoundingClientRect();
        const x = e.clientX - r.left;
        setTip({ x, y: e.clientY - r.top, flipX: x > r.width - 250 });
      }}
      onMouseLeave={() => { setTip(null); onHover(null); }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full select-none" role="img" aria-label="Map of sales by country">
        <defs>
          <filter id="geo-shadow" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#0F172A" floodOpacity="0.12" />
          </filter>
          <clipPath id="geo-clip"><rect width={W} height={H} rx={20} /></clipPath>
        </defs>

        <g clipPath="url(#geo-clip)">
          <rect width={W} height={H} fill={view === "world" ? "#FFFFFF" : OCEAN} />
          <g transform={`translate(${zoom.x},${zoom.y}) scale(${zoom.k})`} onMouseLeave={() => onHover(null)}>
            {sphere && <path d={sphere} fill={OCEAN} />}
            {graticule && <path d={graticule} fill="none" stroke="#E9EEF6" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />}
            {land}
            {/* hovered / selected outline on top */}
            {[selected, hover].filter((c, i, a): c is string => !!c && a.indexOf(c) === i).map((c) => {
              const g = geo.get(c);
              return g ? <path key={`o-${c}`} d={g.d} fill="none" stroke={INK} strokeWidth={c === selected ? 1.6 : 1.1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" pointerEvents="none" /> : null;
            })}
            {sphere && <path d={sphere} fill="none" stroke="#DCE3EE" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />}
          </g>

          {/* anchors: tiny countries get a hoverable marker, the rest a pin dot */}
          {anchors.map(({ c, x, y, tiny }) => (
            <g key={`a-${c.country}`} transform={`translate(${x},${y})`} className="cursor-pointer" onMouseEnter={() => onHover(c.country)} onClick={() => onSelect(c.country)}>
              {tiny && <circle r={9} fill={shade(Math.sqrt(c.soldAed / max))} fillOpacity={0.25} />}
              <circle r={tiny ? 5 : 3} fill={tiny ? shade(Math.sqrt(c.soldAed / max)) : "#FFFFFF"} stroke={tiny ? "#FFFFFF" : INK} strokeWidth={tiny ? 1.5 : 1.2} />
            </g>
          ))}

          {labels.map(({ c, box, ax, ay, leader }) => {
            const cx = Math.min(Math.max(ax, box.x), box.x + box.w);
            const cy = Math.min(Math.max(ay, box.y), box.y + box.h);
            return (
              <g key={`l-${c.country}`} pointerEvents="none" style={{ opacity: hover && hover !== c.country ? 0.45 : 1, transition: "opacity .2s" }}>
                {leader && <line x1={ax} y1={ay} x2={cx} y2={cy} stroke="#94A3B8" strokeWidth={0.8} />}
                <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={10} fill="#FFFFFF" filter="url(#geo-shadow)" />
                <text x={box.x + 10} y={box.y + 15} fontSize={11} fontWeight={600} fill={INK}>{countryName(c.country, true)}</text>
                <text x={box.x + 10} y={box.y + 28} fontSize={10.5} fill="#64748B" style={{ fontVariantNumeric: "tabular-nums" }}>
                  AED {compact(c.soldAed)} · {pct(c.share)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* tooltip */}
      <AnimatePresence>
        {tip && tipData && (
          <motion.div
            key="tip"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute z-10 w-[230px] rounded-2xl bg-white/95 p-3.5 text-[12.5px] shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)] ring-1 ring-slate-200/70 backdrop-blur"
            style={{ left: tip.flipX ? tip.x - 244 : tip.x + 14, top: tip.y + 14 }}
          >
            <div className="flex items-center gap-2 font-medium text-slate-900">
              <span className="text-[16px] leading-none">{flag(tipData.country)}</span>
              <span className="truncate">{countryName(tipData.country)}</span>
            </div>
            <div className="mt-2 text-[20px] font-light tracking-[-0.02em] text-slate-900 tabular-nums">{aed(tipData.soldAed)}</div>
            <div className="text-slate-500 tabular-nums">{fmt(tipData.orders)} orders · {pct(tipData.share)} of sales</div>
            <ul className="mt-2.5 space-y-1 border-t border-slate-100 pt-2">
              {tipData.cities.slice(0, 3).map((c) => (
                <li key={c.city} className="flex justify-between gap-3">
                  <span className="truncate text-slate-600" dir="auto">{c.city}</span>
                  <span className="tabular-nums text-slate-900">{compact(c.soldAed)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 text-[11px] text-slate-400">Click to zoom in</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── side panel ────────────────────────────────────────────────────────── */

function Bar({ value, className = "bg-[#2563EB]" }: { value: number; className?: string }) {
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-slate-100">
      <motion.span className={`block h-full rounded-full ${className}`} initial={{ width: 0 }} animate={{ width: `${Math.max(value * 100, 1.5)}%` }} transition={{ duration: 0.6, ease: EASE }} />
    </span>
  );
}

function CountryList({ data, hover, onHover, onSelect }: { data: SalesByCountry; hover: string | null; onHover: (c: string | null) => void; onSelect: (c: string) => void }) {
  const top = data.countries[0]?.soldAed || 1;
  return (
    <ul className="space-y-0.5" onMouseLeave={() => onHover(null)}>
      {data.countries.map((c, i) => (
        <li key={c.country}>
          <button
            onMouseEnter={() => onHover(c.country)}
            onFocus={() => onHover(c.country)}
            onClick={() => onSelect(c.country)}
            className={`grid w-full grid-cols-[18px_22px_1fr_auto] items-center gap-x-2.5 gap-y-1.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors ${hover === c.country ? "bg-slate-100" : "hover:bg-slate-50"}`}
          >
            <span className="text-[11px] tabular-nums text-slate-400">{i + 1}</span>
            <span className="text-[17px] leading-none">{flag(c.country)}</span>
            <span className="min-w-0 truncate font-medium text-slate-900">
              {countryName(c.country)} <span className="font-normal text-slate-400">· {fmt(c.orders)}</span>
            </span>
            <span className="text-right tabular-nums text-slate-900" title={aed(c.soldAed)}>
              {compact(c.soldAed)} <span className="ml-1 inline-block w-9 text-[11.5px] text-slate-400">{pct(c.share)}</span>
            </span>
            <span className="col-span-2" />
            <span className="col-span-2"><Bar value={c.soldAed / top} /></span>
          </button>
        </li>
      ))}
      {data.countries.length === 0 && <li className="px-2 py-8 text-center text-[13px] text-slate-500">No sales in this range.</li>}
    </ul>
  );
}

function CountryDetail({ c, onBack }: { c: CountrySales; onBack: () => void }) {
  const topCity = c.cities[0]?.soldAed || 1;
  const stores = Object.entries(c.byStore).sort((a, b) => b[1] - a[1]);
  return (
    <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.25, ease: EASE }}>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-slate-500 transition hover:text-slate-900">
        <ArrowLeft size={14} /> All countries
      </button>
      <div className="flex items-center gap-3">
        <span className="text-[30px] leading-none">{flag(c.country)}</span>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-slate-900">{countryName(c.country)}</div>
          <div className={ui.hint}>{pct(c.share)} of sales</div>
        </div>
      </div>
      <div className={`mt-4 ${ui.number}`} title={aed(c.soldAed)}>
        <span className="mr-1.5 text-[14px] font-normal tracking-normal text-slate-400">AED</span>{compact(c.soldAed)}
      </div>
      <div className={ui.caption}>{fmt(c.orders)} orders · avg AED {fmt(c.orders ? c.soldAed / c.orders : 0)}</div>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {stores.map(([s, v]) => (
          <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] text-slate-600" title={aed(v)}>
            <b className="font-semibold text-slate-900">{s}</b> {compact(v)}
          </span>
        ))}
      </div>

      <div className="mb-2 mt-5 flex items-center justify-between">
        <Eyebrow>Cities</Eyebrow>
        <span className={ui.hint}>{c.cities.length}</span>
      </div>
      <ul className="max-h-[260px] space-y-2.5 overflow-y-auto pr-1">
        {c.cities.map((city) => (
          <li key={city.city} className="text-[12.5px]">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-slate-700" dir="auto"><MapPin size={11} className="shrink-0 text-slate-400" />{city.city}</span>
              <span className="shrink-0 tabular-nums text-slate-900" title={aed(city.soldAed)}>
                {compact(city.soldAed)} <span className="text-slate-400">· {city.orders}</span>
              </span>
            </div>
            <Bar value={city.soldAed / topCity} className="bg-slate-800" />
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

/* ── card ──────────────────────────────────────────────────────────────── */

export function GeoSales({ from, to, label }: { from: string; to: string; label: string }) {
  const [shapes, setShapes] = useState<Shape[] | null>(null);
  const [data, setData] = useState<SalesByCountry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("region");
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    loadWorld().then(setShapes, (e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getGeo(from, to)
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e) => { if (live) setError((e as Error).message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [from, to]);

  // a selection that's no longer in the range goes away
  const sel = selected && data?.countries.some((c) => c.country === selected) ? selected : null;
  const selData = sel ? data!.countries.find((c) => c.country === sel)! : null;
  const toggle = useCallback((c: string | null) => setSelected((cur) => (c && cur !== c ? c : null)), []);

  // Omnia ships from the UAE — everything else is cross-border
  const outsideAed = (data?.countries ?? []).filter((c) => c.country !== "AE").reduce((s, c) => s + c.soldAed, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.12, ease: EASE }}
      className={`min-w-0 ${ui.card}`}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Eyebrow>Sales by country</Eyebrow>
          {data && (
            <div className={`mt-2 ${ui.caption}`}>
              {data.countries.length} {data.countries.length === 1 ? "country" : "countries"} · {label}
              {outsideAed > 0 && <> · <span className="text-slate-900 tabular-nums">{pct(data.total.soldAed ? outsideAed / data.total.soldAed : 0)}</span> shipped outside the UAE</>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          {loading && data && <Loader2 size={14} className="animate-spin text-slate-400" />}
          <Seg value={view} onChange={(v) => { setView(v); setSelected(null); }} options={[["region", "Region"], ["world", "World"]]} />
        </div>
      </div>

      {error && <div className="mb-4 rounded-2xl bg-[#FFF1F2] px-4 py-2.5 text-[13px] text-[#BE123C] ring-1 ring-inset ring-[#FECDD3]">Couldn’t load sales by country: {error}</div>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8">
          {shapes && data ? (
            <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .2s" }}>
              <SalesMap shapes={shapes} data={data} view={view} hover={hover} selected={sel} onHover={setHover} onSelect={toggle} />
            </div>
          ) : (
            <div className="flex aspect-[880/470] w-full items-center justify-center gap-2 rounded-[20px] bg-[#F6F8FC] text-[13px] text-slate-500">
              {!error && <><Loader2 size={16} className="animate-spin" /> Drawing the map…</>}
            </div>
          )}
          {data && data.countries.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-2.5 text-[11.5px] text-slate-400">
                <span>Less</span>
                <span className="h-1.5 w-28 rounded-full" style={{ background: `linear-gradient(90deg, ${shade(0)}, ${shade(0.5)}, ${shade(1)})` }} />
                <span>More</span>
              </div>
              {data.unknown.orders > 0 && (
                <span className="text-[11.5px] text-slate-400" title={aed(data.unknown.soldAed)}>
                  {fmt(data.unknown.orders)} orders (AED {compact(data.unknown.soldAed)}) have no country and aren’t on the map
                </span>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 xl:col-span-4">
          <AnimatePresence mode="wait">
            {selData ? (
              <CountryDetail key={selData.country} c={selData} onBack={() => setSelected(null)} />
            ) : data ? (
              <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                <CountryList data={data} hover={hover} onHover={setHover} onSelect={(c) => toggle(c)} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
