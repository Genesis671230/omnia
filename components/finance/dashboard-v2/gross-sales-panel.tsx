"use client";

/* Gross Sales from store orders — the top-line "what did we sell" panel.
   Today, yesterday and the trailing 7 days as headline tiles, plus a daily
   bar chart stacked by store.

   This is deliberately its own panel rather than another cut of the revenue
   area chart above it: that one is fed by the dashboard payload, this one
   comes straight from the orders table with no payout or settlement input, so
   the number cannot move when a gateway settles late. Paid orders only, with
   the excluded orders stated underneath rather than quietly dropped. */

import { useCallback, useEffect, useState } from "react";
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

export function GrossSalesPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/gross-sales?days=${days}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setData(json as Report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
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

  if (error) {
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
            <CartesianGrid vertical={false} stroke="rgba(0,0,0,.06)" />
            <XAxis
              dataKey="day"
              tickFormatter={shortDate}
              tick={{ fontSize: 10, fill: "#9a8b73" }}
              axisLine={false}
              tickLine={false}
              minTickGap={22}
            />
            <YAxis
              tickFormatter={(v) => compact(Number(v))}
              tick={{ fontSize: 10, fill: "#9a8b73" }}
              axisLine={false}
              tickLine={false}
              width={46}
            />
            <Tooltip content={<GrossTip />} cursor={{ fill: "rgba(124,58,237,.07)" }} />
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

export const GROSS_SALES_CSS = `
.gs-panel { display: flex; flex-direction: column; gap: 16px; }
.gs-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.gs-loading { display: flex; align-items: center; gap: 8px; padding: 28px 4px; font-size: 13px; color: #9a8b73; }
.gs-error { padding: 8px 0 4px; font-size: 13px; }
.gs-error p { margin: 0 0 10px; }
.gs-error button { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(0,0,0,.12); background: transparent; font-size: 12px; cursor: pointer; }

.gs-windows { display: inline-flex; gap: 2px; padding: 2px; border-radius: 9px; background: rgba(0,0,0,.04); }
.gs-windows button { min-height: 32px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent; font-size: 12px; font-weight: 600; color: #7b6f5c; cursor: pointer; }
.gs-windows button.on { background: #fff; color: #1c1917; box-shadow: 0 1px 3px rgba(0,0,0,.1); }

.gs-tiles { display: grid; gap: 12px; grid-template-columns: 1fr; }
@media (min-width: 720px) { .gs-tiles { grid-template-columns: repeat(3, 1fr); } }
.gs-tile { padding: 14px 16px; border: 1px solid rgba(0,0,0,.07); border-radius: 12px; background: rgba(255,255,255,.55); }
.gs-tile h3 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: #9a8b73; }
.gs-amount { margin: 6px 0 0; font-size: 25px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; color: #1c1917; }
.gs-sub { margin: 2px 0 0; font-size: 12px; color: #9a8b73; font-variant-numeric: tabular-nums; }
.gs-delta { display: inline-flex; align-items: center; gap: 4px; margin: 8px 0 0; font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.gs-delta.up { color: #15803d; }
.gs-delta.down { color: #b91c1c; }
.gs-delta.flat { color: #9a8b73; }
.gs-partial { margin: 3px 0 0; font-size: 10.5px; color: #b3a691; }

.gs-stores { list-style: none; margin: 12px 0 0; padding: 10px 0 0; border-top: 1px solid rgba(0,0,0,.06); display: grid; gap: 5px; }
.gs-stores li { display: flex; align-items: center; gap: 7px; font-size: 11.5px; }
.gs-stores i { width: 7px; height: 7px; border-radius: 999px; flex: none; }
.gs-store-name { color: #7b6f5c; font-weight: 600; }
.gs-store-amt { margin-left: auto; font-variant-numeric: tabular-nums; color: #1c1917; }

.gs-chart { min-width: 0; }
.gs-legend-label { font-size: 11px; color: #7b6f5c; }
.gs-tip-total { border-top: 1px solid rgba(255,255,255,.16); margin-top: 4px; padding-top: 4px; }

.gs-foot { font-size: 11.5px; line-height: 1.55; color: #9a8b73; }
.gs-foot p { margin: 0; }
.gs-excluded { margin-top: 6px; }
.gs-foot b { color: #7b6f5c; font-variant-numeric: tabular-nums; }
`;
