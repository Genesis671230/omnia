"use client";

/* Gross Sales from store orders — the top-line "what did we sell" panel.
   Today, yesterday and the trailing 7 days as headline tiles, plus a daily
   bar chart stacked by store.

   This is deliberately its own panel rather than another cut of the revenue
   area chart above it: that one is fed by the dashboard payload, this one
   comes straight from the orders table with no payout or settlement input, so
   the number cannot move when a gateway settles late. Paid orders only, with
   the excluded orders stated underneath rather than quietly dropped. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { STORE_COLOR, aed, compact, shortDate } from "./types";

type StoreAmount = { store: string; label: string; grossAed: number; orders: number };
type Rollup = {
  key: string;
  label: string;
  fromDay: string;
  toDay: string;
  grossAed: number;
  orders: number;
  byStore: StoreAmount[];
  previousGrossAed: number | null;
  deltaPct: number | null;
};
type DayBucket = { day: string; grossAed: number; orders: number; byStore: Record<string, number> };
type Report = {
  asOfDay: string;
  stores: string[];
  storeLabels: Record<string, string>;
  today: Rollup;
  yesterday: Rollup;
  last7: Rollup;
  series: DayBucket[];
  excluded: {
    fromDay: string;
    toDay: string;
    unpaidOrders: number;
    unpaidGrossAed: number;
    cancelledOrders: number;
    cancelledGrossAed: number;
    undatedOrders: number;
  };
};

const WINDOWS = [14, 30, 90];

/* The order sync writes new orders into Supabase every 2 minutes
   (lib/scheduler/order-sync-scheduler.ts). Polling a little faster than that
   means a new order shows up here within roughly a minute of landing, without
   anyone reloading the page — the panel used to fetch once on mount and then
   sit on a stale number all day. */
const REFRESH_MS = 60_000;

function agoLabel(ms: number): string {
  const s = Math.max(Math.round(ms / 1000), 0);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function GrossSalesPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // Re-renders the "updated Xs ago" label on its own clock, so the text stays
  // honest between fetches instead of freezing at "just now".
  const [, setTick] = useState(0);
  // Read by the interval and the focus listener so neither has to be torn down
  // and rebuilt every time `days` changes.
  const daysRef = useRef(days);
  daysRef.current = days;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/orders/gross-sales?days=${daysRef.current}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setData(json as Report);
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      // A failed background poll must not blank out a panel that is already
      // showing good numbers — keep the last good data and say it's stale.
      setError((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Refetch when the window changes, and on first mount.
  useEffect(() => {
    void load();
  }, [days, load]);

  useEffect(() => {
    const timer = setInterval(() => {
      // A hidden tab burns quota refreshing numbers nobody is looking at.
      if (typeof document !== "undefined" && document.hidden) return;
      void load(true);
    }, REFRESH_MS);
    const clock = setInterval(() => setTick((t) => t + 1), 15_000);

    // Coming back to the tab is the moment the number is most likely stale and
    // most likely being read, so refresh immediately rather than waiting out
    // the rest of the interval.
    const onVisible = () => {
      if (!document.hidden) void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      clearInterval(timer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [load]);

  if (loading && !data) {
    return (
      <section className="dv2-panel gs-panel">
        <style>{GROSS_SALES_CSS}</style>
        <div className="gs-loading">
          <Loader2 size={16} className="dv2-spin" /> Reading orders…
        </div>
      </section>
    );
  }

  // Only surrender the whole panel when there is nothing good to show. A poll
  // that fails while real numbers are on screen shows a stale banner instead.
  if (error && !data) {
    return (
      <section className="dv2-panel gs-panel">
        <style>{GROSS_SALES_CSS}</style>
        <header className="dv2-panel-head">
          <h2>Gross Sales</h2>
        </header>
        <div className="gs-error">
          <p>Could not load gross sales. {error}</p>
          <button type="button" onClick={() => void load()}>
            <RefreshCw size={12} /> Try again
          </button>
        </div>
      </section>
    );
  }

  if (!data) return null;

  const rollups = [data.today, data.yesterday, data.last7];
  const chartRows = data.series.map((d) => ({ day: d.day, ...d.byStore }));
  const excludedCount =
    data.excluded.unpaidOrders + data.excluded.cancelledOrders;

  return (
    <section className="dv2-panel gs-panel" style={{ opacity: loading ? 0.65 : 1 }}>
      <style>{GROSS_SALES_CSS}</style>

      <header className="dv2-panel-head gs-head">
        <div>
          <h2>Gross Sales</h2>
          <span>store orders only · paid · all four stores · Dubai time</span>
        </div>
        <div className="gs-controls">
          <button
            type="button"
            className="gs-live"
            onClick={() => void load(true)}
            title="Refresh now"
            aria-label={`Refresh now. Last updated ${updatedAt ? agoLabel(Date.now() - updatedAt) : "never"}`}
          >
            <i className={error ? "gs-live-dot stale" : "gs-live-dot"} />
            {error ? "Stale" : "Live"}
            <b>{updatedAt ? agoLabel(Date.now() - updatedAt) : "…"}</b>
            <RefreshCw size={11} className={loading ? "dv2-spin" : ""} />
          </button>
          <div className="gs-windows" role="group" aria-label="Chart window">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={days === w}
                className={days === w ? "on" : ""}
                onClick={() => setDays(w)}
              >
                {w}d
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="gs-tiles">
        {rollups.map((r) => (
          <article key={r.key} className="gs-tile">
            <h3>{r.key === "today" ? "Today so far" : r.label}</h3>
            <p className="gs-amount">{aed(r.grossAed)}</p>
            <p className="gs-sub">
              {r.orders.toLocaleString()} paid {r.orders === 1 ? "order" : "orders"}
            </p>
            <Delta rollup={r} />
            <ul className="gs-stores">
              {r.byStore.map((s) => (
                <li key={s.store}>
                  <i style={{ background: STORE_COLOR[s.store] ?? "#94a3b8" }} />
                  <span className="gs-store-name">{s.store}</span>
                  <span className="gs-store-amt">{aed(s.grossAed)}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="gs-chart">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartRows} margin={{ left: -8, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,.10)" />
            <XAxis
              dataKey="day"
              tickFormatter={shortDate}
              tick={{ fontSize: 10, fill: "#9db4d8" }}
              axisLine={false}
              tickLine={false}
              minTickGap={22}
            />
            <YAxis
              tickFormatter={(v) => compact(Number(v))}
              tick={{ fontSize: 10, fill: "#9db4d8" }}
              axisLine={false}
              tickLine={false}
              width={46}
            />
            <Tooltip content={<GrossTip />} cursor={{ fill: "rgba(147,197,253,.10)" }} />
            <Legend
              verticalAlign="bottom"
              height={28}
              iconType="circle"
              iconSize={8}
              formatter={(v) => <span className="gs-legend-label">{v}</span>}
            />
            {data.stores.map((s, i) => (
              <Bar
                key={s}
                dataKey={s}
                stackId="gross"
                name={s}
                fill={STORE_COLOR[s] ?? "#94a3b8"}
                radius={i === data.stores.length - 1 ? [3, 3, 0, 0] : undefined}
                maxBarSize={34}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <footer className="gs-foot">
        <p>
          Gross Sales counts paid orders at their full order value, before
          gateway fees, refunds and VAT. It is the top line, not the payout.
        </p>
        {excludedCount > 0 && (
          <p className="gs-excluded">
            Not counted over these {data.series.length} days:{" "}
            <b>{data.excluded.unpaidOrders.toLocaleString()}</b> unpaid or
            pending ({aed(data.excluded.unpaidGrossAed)}) and{" "}
            <b>{data.excluded.cancelledOrders.toLocaleString()}</b> cancelled,
            refunded or voided ({aed(data.excluded.cancelledGrossAed)}).
            {data.excluded.undatedOrders > 0 && (
              <>
                {" "}
                <b>{data.excluded.undatedOrders.toLocaleString()}</b> have no
                order date and cannot be placed on a day.
              </>
            )}
          </p>
        )}
      </footer>
    </section>
  );
}

function Delta({ rollup }: { rollup: Rollup }) {
  const { deltaPct, previousGrossAed, key } = rollup;
  const against =
    key === "last7" ? "vs previous 7 days" : key === "today" ? "vs yesterday" : "vs the day before";

  if (deltaPct === null) {
    return (
      <p className="gs-delta flat">
        <Minus size={11} />
        {previousGrossAed === 0 || previousGrossAed === null
          ? `No sales ${against.replace("vs ", "")}`
          : `Flat ${against}`}
      </p>
    );
  }

  const up = deltaPct > 0;
  const flat = deltaPct === 0;
  return (
    <>
      <p className={`gs-delta ${flat ? "flat" : up ? "up" : "down"}`}>
        {flat ? <Minus size={11} /> : up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
        {up ? "+" : ""}
        {deltaPct}% {against}
      </p>
      {/* A part-day against a whole day reads as a collapse every morning.
          Say so rather than letting the founder act on it. */}
      {key === "today" && (
        <p className="gs-partial">Part day against a full one</p>
      )}
    </>
  );
}

function GrossTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => Number(p.value) > 0);
  const total = payload.reduce((a, p) => a + Number(p.value || 0), 0);
  return (
    <div className="dv2-tip">
      {label && <div className="dv2-tip-label">{shortDate(label)}</div>}
      {rows.map((p, i) => (
        <div key={i} className="dv2-tip-row">
          <span style={{ background: p.color }} />
          {p.name}: <b>{aed(Number(p.value))}</b>
        </div>
      ))}
      <div className="dv2-tip-row gs-tip-total">
        Total: <b>{aed(total)}</b>
      </div>
      {rows.length === 0 && <div className="dv2-tip-row">No paid orders</div>}
    </div>
  );
}

/* Gross Sales is the one panel on this dashboard that is pure top line, so it
   is deliberately the one panel that does not sit on the warm cream card. Deep
   indigo, a soft light off the top-left, and a fine grain over the whole thing
   — the grain is an inline feTurbulence SVG rather than an image file, so it
   costs no request and scales without banding on a retina screen. Everything
   inside is re-toned for a dark ground: the store dots (sky / emerald / amber /
   violet) all clear 4.5:1 against #131c38, and the muted text sits at #9db4d8
   rather than the cream palette's #9a8b73, which would disappear. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)' opacity='.42'/%3E%3C/svg%3E\")";

export const GROSS_SALES_CSS = `
.gs-panel { position: relative; display: flex; flex-direction: column; gap: 16px; overflow: hidden;
  border: 1px solid #2b3a66;
  background:
    radial-gradient(120% 90% at 8% -10%, rgba(99,130,255,.32), transparent 58%),
    radial-gradient(90% 70% at 100% 0%, rgba(56,189,248,.16), transparent 55%),
    linear-gradient(160deg, #1b2748 0%, #131c38 46%, #0d142b 100%);
  box-shadow: 0 22px 50px -30px rgba(13,20,43,.85), inset 0 1px 0 rgba(255,255,255,.07);
  color: #e8eefc; }
/* Grain and a faint grid, both non-interactive so clicks fall through. */
.gs-panel::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background-image: ${GRAIN}; background-size: 180px 180px; opacity: .16; mix-blend-mode: overlay; }
.gs-panel::after { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background-image: linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px);
  background-size: 26px 26px; opacity: .8;
  mask-image: radial-gradient(110% 80% at 12% 0%, #000 10%, transparent 72%);
  -webkit-mask-image: radial-gradient(110% 80% at 12% 0%, #000 10%, transparent 72%); }
.gs-panel > * { position: relative; z-index: 1; }

.gs-panel .dv2-panel-head h2 { color: #f4f7ff; }
.gs-panel .dv2-panel-head span { color: #9db4d8; }

.gs-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.gs-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gs-loading { display: flex; align-items: center; gap: 8px; padding: 28px 4px; font-size: 13px; color: #9db4d8; }
.gs-error { padding: 8px 0 4px; font-size: 13px; color: #e8eefc; }
.gs-error p { margin: 0 0 10px; }
.gs-error button { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.06); color: #e8eefc; font-size: 12px; cursor: pointer; }

/* Live indicator doubles as the manual refresh button — one affordance, and
   it always states how old the number on screen actually is. */
.gs-live { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 11px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.06); color: #c7d7f5;
  font-size: 11.5px; font-weight: 600; cursor: pointer; }
.gs-live:hover { background: rgba(255,255,255,.12); color: #f4f7ff; }
.gs-live b { font-weight: 500; color: #8ba4cc; font-variant-numeric: tabular-nums; }
.gs-live-dot { width: 6px; height: 6px; border-radius: 999px; background: #34d399; flex: none; animation: gsbeat 2s infinite; }
.gs-live-dot.stale { background: #fbbf24; animation: none; }
@keyframes gsbeat { 0% { box-shadow: 0 0 0 0 rgba(52,211,153,.5); } 70% { box-shadow: 0 0 0 6px rgba(52,211,153,0); } 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); } }
@media (prefers-reduced-motion: reduce) { .gs-live-dot { animation: none; } }

.gs-windows { display: inline-flex; gap: 2px; padding: 2px; border-radius: 9px; background: rgba(255,255,255,.07); }
.gs-windows button { min-height: 32px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent; font-size: 12px; font-weight: 600; color: #9db4d8; cursor: pointer; }
.gs-windows button.on { background: rgba(255,255,255,.94); color: #131c38; box-shadow: 0 1px 3px rgba(0,0,0,.3); }

.gs-tiles { display: grid; gap: 12px; grid-template-columns: 1fr; }
@media (min-width: 720px) { .gs-tiles { grid-template-columns: repeat(3, 1fr); } }
.gs-tile { position: relative; padding: 14px 16px; border: 1px solid rgba(255,255,255,.12); border-radius: 12px;
  background: linear-gradient(165deg, rgba(255,255,255,.09), rgba(255,255,255,.035));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }
.gs-tile h3 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: #9db4d8; }
.gs-amount { margin: 6px 0 0; font-size: 25px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; color: #ffffff; }
.gs-sub { margin: 2px 0 0; font-size: 12px; color: #9db4d8; font-variant-numeric: tabular-nums; }
.gs-delta { display: inline-flex; align-items: center; gap: 4px; margin: 8px 0 0; font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.gs-delta.up { color: #4ade80; }
.gs-delta.down { color: #fb7185; }
.gs-delta.flat { color: #9db4d8; }
.gs-partial { margin: 3px 0 0; font-size: 10.5px; color: #7d93b8; }

.gs-stores { list-style: none; margin: 12px 0 0; padding: 10px 0 0; border-top: 1px solid rgba(255,255,255,.12); display: grid; gap: 5px; }
.gs-stores li { display: flex; align-items: center; gap: 7px; font-size: 11.5px; }
.gs-stores i { width: 7px; height: 7px; border-radius: 999px; flex: none; }
.gs-store-name { color: #9db4d8; font-weight: 600; }
.gs-store-amt { margin-left: auto; font-variant-numeric: tabular-nums; color: #f4f7ff; }

.gs-chart { min-width: 0; }
.gs-legend-label { font-size: 11px; color: #9db4d8; }
.gs-tip-total { border-top: 1px solid rgba(255,255,255,.16); margin-top: 4px; padding-top: 4px; }

.gs-foot { font-size: 11.5px; line-height: 1.55; color: #8ba4cc; }
.gs-foot p { margin: 0; }
.gs-excluded { margin-top: 6px; }
.gs-foot b { color: #c7d7f5; font-variant-numeric: tabular-nums; }
`;
