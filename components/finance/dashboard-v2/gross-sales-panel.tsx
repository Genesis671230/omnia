"use client";

/* Gross Sales from store orders — the top-line "what did we sell" panel.
   Today, yesterday and the trailing 7 days as headline tiles, then a month
   picker driving a daily bar chart stacked by store and a day list. Every day
   opens a drawer with the orders behind its amount, each traced to its payout
   file line (fee, net) and bank credit, with the reason when money isn't in
   yet (/api/orders/sales-ledger).

   This is deliberately its own panel rather than another cut of the revenue
   area chart above it: that one is fed by the dashboard payload, this one
   comes straight from the orders table with no payout or settlement input, so
   the number cannot move when a gateway settles late. Paid orders only, with
   the excluded orders stated underneath rather than quietly dropped. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, TrendingUp, TrendingDown, Minus, RefreshCw, ChevronLeft, ChevronRight, FileX, ChevronRight as Go, Download } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { STORE_COLOR, aed, compact, shortDate } from "./types";
import { DaySalesDrawer, STATUS_META, downloadSalesXlsx, type LedgerDay, type LedgerStatus } from "./day-sales-drawer";
import { toast } from "sonner";

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

type Ledger = {
  month: string;
  label: string;
  fromDay: string;
  toDay: string;
  stores: string[];
  totals: {
    grossAed: number;
    orders: number;
    feeAed: number;
    receivedAed: number;
    receivedGrossAed: number;
    statusCounts: Record<LedgerStatus, { orders: number; grossAed: number }>;
  };
  missingPayoutFiles: { gateway: string; orders: number; grossAed: number; days: string[] }[];
  excludedOrders: number;
  days: LedgerDay[];
  payoutSyncErrors: { provider: string; error: string; at: string | null }[];
};

const STATUS_KEYS = Object.keys(STATUS_META) as LedgerStatus[];

/** Current Dubai month, YYYY-MM. */
function dubaiMonth(offsetMonths = 0): string {
  const now = new Date(Date.now() + 4 * 3600_000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
  return d.toISOString().slice(0, 7);
}
function monthLabel(m: string): string {
  return new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
/** The last 18 months, newest first — enough to reach back past a year-end close. */
const MONTH_OPTIONS = Array.from({ length: 18 }, (_, i) => dubaiMonth(-i));

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
  const [month, setMonth] = useState(() => dubaiMonth());
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [exportingMonth, setExportingMonth] = useState(false);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // Re-renders the "updated Xs ago" label on its own clock, so the text stays
  // honest between fetches instead of freezing at "just now".
  const [, setTick] = useState(0);
  // Read by the interval and the focus listener so neither has to be torn down
  // and rebuilt every time the month changes.
  const monthRef = useRef(month);
  monthRef.current = month;

  // The ledger traces every order to its payout file and bank credit, so it is
  // the heavier read. Polled only while the current month is on screen — a
  // closed month only changes when someone uploads a file, and the refresh
  // button covers that.
  const loadLedger = useCallback(async (silent = false) => {
    const m = monthRef.current;
    if (!silent) setLedgerLoading(true);
    try {
      const res = await fetch(`/api/orders/sales-ledger?month=${m}`, { cache: "no-store" });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) throw new Error(`Unexpected response (${res.status}) — session may have expired`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      if (monthRef.current !== m) return; // a newer month was picked mid-flight
      setLedger(json as Ledger);
      setLedgerError(null);
    } catch (e) {
      if (monthRef.current === m) setLedgerError((e as Error).message);
    } finally {
      if (!silent && monthRef.current === m) setLedgerLoading(false);
    }
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent || monthRef.current === dubaiMonth()) void loadLedger(silent);
    try {
      const res = await fetch(`/api/orders/gross-sales?days=30`, { cache: "no-store" });
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

  // Tiles on first mount; the ledger again whenever the month changes.
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setOpenDay(null);
    void loadLedger();
  }, [month, loadLedger]);

  const openLedgerDay = useMemo(
    () => (openDay && ledger ? ledger.days.find((d) => d.day === openDay) ?? null : null),
    [openDay, ledger],
  );

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
  const chartRows = (ledger?.days ?? []).map((d) => ({ day: d.day, ...d.byStore }));
  const chartStores = ledger?.stores ?? data.stores;
  const monthIdx = MONTH_OPTIONS.indexOf(month);
  const salesDays = (ledger?.days ?? []).filter((d) => d.orders > 0).slice().reverse();
  const t = ledger?.totals;

  return (
    <section className="dv2-panel gs-panel" style={{ opacity: loading ? 0.65 : 1 }}>
      <style>{GROSS_SALES_CSS}</style>

      <header className="dv2-panel-head gs-head">
        <div>
          <h2>Gross Sales</h2>
          <span>store orders · paid, prepaid WhatsApp and COD · all four stores · Dubai time</span>
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
          <div className="gs-month" role="group" aria-label="Month">
            <button
              type="button"
              aria-label="Previous month"
              disabled={monthIdx === MONTH_OPTIONS.length - 1}
              onClick={() => setMonth(MONTH_OPTIONS[Math.min(monthIdx + 1, MONTH_OPTIONS.length - 1)])}
            >
              <ChevronLeft size={14} />
            </button>
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Select month">
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Next month"
              disabled={monthIdx <= 0}
              onClick={() => setMonth(MONTH_OPTIONS[Math.max(monthIdx - 1, 0)])}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </header>

      <div className="gs-tiles">
        {rollups.map((r) => (
          <article key={r.key} className="gs-tile">
            <h3>{r.key === "today" ? "Today so far" : r.label}</h3>
            <p className="gs-amount">{aed(r.grossAed)}</p>
            <p className="gs-sub">
              {r.orders.toLocaleString()} {r.orders === 1 ? "order" : "orders"}
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

      <div className="gs-month-head">
        <h3>{monthLabel(month)}</h3>
        {ledgerLoading && <Loader2 size={13} className="dv2-spin" />}
        <span>click a day to see its orders, fees and bank credits</span>
        <button
          type="button"
          className="gs-export"
          disabled={exportingMonth || !ledger || ledger.totals.orders === 0}
          onClick={async () => {
            setExportingMonth(true);
            try { await downloadSalesXlsx({ month }); }
            catch (e) { toast.error((e as Error).message); }
            finally { setExportingMonth(false); }
          }}
        >
          {exportingMonth ? <Loader2 size={12} className="dv2-spin" /> : <Download size={12} />} Export month .xlsx
        </button>
      </div>

      {ledgerError && !ledger && (
        <div className="gs-error">
          <p>Could not load {monthLabel(month)}. {ledgerError}</p>
          <button type="button" onClick={() => void loadLedger()}><RefreshCw size={12} /> Try again</button>
        </div>
      )}

      {t && (
        <div className="gs-msum" style={{ opacity: ledgerLoading ? 0.6 : 1 }}>
          <div><span>Gross sales</span><b>{aed(t.grossAed)}</b><em>{t.orders.toLocaleString()} orders</em></div>
          <div><span>Received in bank</span><b>{aed(t.receivedAed)}</b><em>net of fees · {t.statusCounts.received.orders} orders</em></div>
          <div><span>Gateway fees</span><b>{aed(t.feeAed)}</b><em>{t.grossAed > 0 ? `${((t.feeAed / t.grossAed) * 100).toFixed(1)}% of gross` : "—"}</em></div>
          <div><span>Not in bank yet</span><b>{aed(Math.max(t.grossAed - t.receivedGrossAed, 0))}</b><em>gross, see reasons below</em></div>
        </div>
      )}

      {t && t.orders > 0 && (
        <div className="gs-statusbar" aria-label="Where this month's sales are in the money chain">
          {STATUS_KEYS.filter((k) => t.statusCounts[k].grossAed > 0).map((k) => (
            <i
              key={k}
              title={`${STATUS_META[k].label}: ${t.statusCounts[k].orders} orders · ${aed(t.statusCounts[k].grossAed)}`}
              style={{ flexGrow: t.statusCounts[k].grossAed, background: STATUS_META[k].color }}
            />
          ))}
        </div>
      )}
      {t && t.orders > 0 && (
        <div className="gs-statuslegend">
          {STATUS_KEYS.filter((k) => t.statusCounts[k].orders > 0).map((k) => (
            <span key={k}><i style={{ background: STATUS_META[k].color }} />{STATUS_META[k].label} · {t.statusCounts[k].orders} · {aed(t.statusCounts[k].grossAed)}</span>
          ))}
        </div>
      )}

      {ledger && ledger.missingPayoutFiles.length > 0 && (
        <div className="gs-missing" role="status">
          <FileX size={14} />
          <div>
            <b>Payout file not uploaded yet</b>
            {ledger.missingPayoutFiles.map((m) => (
              <p key={m.gateway}>
                {m.gateway}: {m.orders} {m.orders === 1 ? "order" : "orders"} · {aed(m.grossAed)} across {m.days.length}{" "}
                {m.days.length === 1 ? "day" : "days"} ({shortDate(m.days[0])}
                {m.days.length > 1 ? ` – ${shortDate(m.days[m.days.length - 1])}` : ""})
              </p>
            ))}
          </div>
          <a href="/reconciliation">Upload in Reconciliation</a>
        </div>
      )}

      {ledger && ledger.payoutSyncErrors.length > 0 && (
        <div className="gs-missing gs-syncerr" role="status">
          <FileX size={14} />
          <div>
            <b>Automatic payout sync is blocked</b>
            {ledger.payoutSyncErrors.map((e) => (
              <p key={e.provider}>{e.error}</p>
            ))}
          </div>
        </div>
      )}

      <div className="gs-chart" style={{ opacity: ledgerLoading ? 0.6 : 1 }}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={chartRows}
            margin={{ left: -8, right: 8, top: 8, bottom: 0 }}
            onClick={(st) => {
              const day = st?.activeLabel as string | undefined;
              if (day && ledger?.days.some((d) => d.day === day && d.orders > 0)) setOpenDay(day);
            }}
            style={{ cursor: "pointer" }}
          >
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,.10)" />
            <XAxis
              dataKey="day"
              tickFormatter={(d: string) => String(Number(d.slice(8, 10)))}
              tick={{ fontSize: 10, fill: "#9db4d8" }}
              axisLine={false}
              tickLine={false}
              interval={0}
              minTickGap={0}
            />
            <YAxis
              tickFormatter={(v) => compact(Number(v))}
              tick={{ fontSize: 10, fill: "#9db4d8" }}
              axisLine={false}
              tickLine={false}
              width={46}
            />
            <Tooltip content={<GrossTip ledger={ledger} />} cursor={{ fill: "rgba(147,197,253,.10)" }} />
            <Legend
              verticalAlign="bottom"
              height={28}
              iconType="circle"
              iconSize={8}
              formatter={(v) => <span className="gs-legend-label">{v}</span>}
            />
            {chartStores.map((s, i) => (
              <Bar
                key={s}
                dataKey={s}
                stackId="gross"
                name={s}
                fill={STORE_COLOR[s] ?? "#94a3b8"}
                radius={i === chartStores.length - 1 ? [3, 3, 0, 0] : undefined}
                maxBarSize={26}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {ledger && (
        <div className="gs-days">
          <div className="gs-days-head">
            <span>Day</span><span>Orders</span><span className="r">Gross</span><span className="r">Fees</span><span className="r">Received</span><span>Status</span>
          </div>
          {salesDays.length === 0 && <p className="gs-days-empty">No sales in {monthLabel(month)}.</p>}
          {salesDays.map((d) => {
            const head = d.headline === "empty" ? null : STATUS_META[d.headline];
            return (
              <button key={d.day} type="button" className="gs-day" onClick={() => setOpenDay(d.day)}>
                <span className="gs-day-date">{new Date(`${d.day}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
                <span className="gs-day-n">{d.orders}</span>
                <b className="r">{aed(d.grossAed)}</b>
                <span className="r gs-day-fee">{aed(d.feeAed)}</span>
                <span className="r gs-day-recv">{d.receivedAed > 0 ? aed(d.receivedAed) : "—"}</span>
                <span className="gs-day-why">
                  <span className="gs-day-bar">
                    {STATUS_KEYS.filter((k) => d.statusCounts[k].grossAed > 0).map((k) => (
                      <i key={k} style={{ flexGrow: d.statusCounts[k].grossAed, background: STATUS_META[k].color }} />
                    ))}
                  </span>
                  <span className="gs-day-reason" style={{ color: head && d.headline !== "received" ? "#e8eefc" : "#9db4d8" }}>{d.reason}</span>
                </span>
                <Go size={13} className="gs-day-go" />
              </button>
            );
          })}
        </div>
      )}

      <footer className="gs-foot">
        <p>
          Gross Sales counts sales at their full order value, before
          gateway fees, refunds and VAT. It is the top line, not the payout.
        </p>
        {ledger && ledger.excludedOrders > 0 && (
          <p className="gs-excluded">
            Not counted in {monthLabel(month)}: <b>{ledger.excludedOrders.toLocaleString()}</b> failed,
            unpaid, zero-value, cancelled or refunded {ledger.excludedOrders === 1 ? "order" : "orders"}.
          </p>
        )}
        <p className="gs-excluded">
          Fees come from the payout file where it states them per order, are split from the file total where it
          only states a total, and are estimated at the gateway&apos;s rate where no file is uploaded yet.
        </p>
      </footer>

      <DaySalesDrawer day={openLedgerDay} onClose={() => setOpenDay(null)} />
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
  ledger,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string }[];
  label?: string;
  ledger?: Ledger | null;
}) {
  const day = label ? ledger?.days.find((d) => d.day === label) : undefined;
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
      {day && day.orders > 0 && (
        <>
          <div className="dv2-tip-row">{day.orders} {day.orders === 1 ? "order" : "orders"} · fees {aed(day.feeAed)}</div>
          <div className="dv2-tip-row gs-tip-why">{day.reason}</div>
          <div className="dv2-tip-row gs-tip-cta">Click to open the orders</div>
        </>
      )}
      {rows.length === 0 && <div className="dv2-tip-row">No sales</div>}
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

.gs-month { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: 9px; background: rgba(255,255,255,.07); }
.gs-month button { display: grid; place-items: center; width: 32px; min-height: 32px; border: 0; border-radius: 7px; background: transparent; color: #c7d7f5; cursor: pointer; }
.gs-month button:hover:not(:disabled) { background: rgba(255,255,255,.12); }
.gs-month button:disabled { opacity: .35; cursor: default; }
.gs-month select { min-height: 32px; border: 0; border-radius: 7px; padding: 0 8px; background: rgba(255,255,255,.94); color: #131c38; font-size: 12px; font-weight: 600; cursor: pointer; }

.gs-month-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; border-top: 1px solid rgba(255,255,255,.1); padding-top: 14px; }
.gs-month-head h3 { margin: 0; font-family: Georgia, serif; font-weight: 500; font-size: 16px; color: #f4f7ff; }
.gs-month-head span { font-size: 11.5px; color: #8ba4cc; }
.gs-export { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.06); color: #e8eefc; font-size: 12px; font-weight: 600; cursor: pointer; }
.gs-export:hover:not(:disabled) { background: rgba(255,255,255,.12); }
.gs-export:disabled { opacity: .45; cursor: default; }

.gs-msum { display: grid; gap: 10px; grid-template-columns: repeat(2, 1fr); transition: opacity .15s; }
@media (min-width: 820px) { .gs-msum { grid-template-columns: repeat(4, 1fr); } }
.gs-msum div { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); }
.gs-msum span { font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #9db4d8; }
.gs-msum b { font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; color: #fff; }
.gs-msum em { font-style: normal; font-size: 11px; color: #8ba4cc; }

.gs-statusbar { display: flex; height: 8px; border-radius: 999px; overflow: hidden; gap: 2px; background: rgba(255,255,255,.06); }
.gs-statusbar i { display: block; min-width: 3px; }
.gs-statuslegend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 11px; color: #c7d7f5; margin-top: -8px; }
.gs-statuslegend span { display: inline-flex; align-items: center; gap: 5px; font-variant-numeric: tabular-nums; }
.gs-statuslegend i { width: 8px; height: 8px; border-radius: 999px; }

.gs-missing { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(251,113,133,.35); background: rgba(251,113,133,.09); color: #fecdd3; font-size: 12px; }
.gs-missing > svg { flex: none; margin-top: 2px; color: #fb7185; }
.gs-missing div { flex: 1; min-width: 0; }
.gs-missing b { color: #ffe4e6; font-weight: 650; }
.gs-missing p { margin: 2px 0 0; font-variant-numeric: tabular-nums; }
.gs-missing a { flex: none; align-self: center; color: #ffe4e6; font-weight: 600; font-size: 11.5px; text-decoration: underline; text-underline-offset: 2px; }

.gs-syncerr { border-color: rgba(251,191,36,.4); background: rgba(251,191,36,.09); color: #fde68a; }
.gs-syncerr > svg { color: #fbbf24; }
.gs-syncerr b { color: #fef3c7; }
.gs-days { display: flex; flex-direction: column; gap: 4px; }
.gs-days-head, .gs-day { display: grid; grid-template-columns: 96px 50px 96px 80px 96px minmax(0, 1fr) 16px; gap: 10px; align-items: center; }
.gs-days-head { padding: 0 12px 4px; font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #7d93b8; }
.gs-days .r { text-align: right; }
.gs-days-empty { margin: 4px 0; font-size: 12.5px; color: #9db4d8; }
.gs-day { width: 100%; min-height: 40px; padding: 7px 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; background: rgba(255,255,255,.035); color: #e8eefc; font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; transition: background .15s, border-color .15s; }
.gs-day:hover, .gs-day:focus-visible { background: rgba(255,255,255,.09); border-color: rgba(147,197,253,.45); outline: none; }
.gs-day b { font-weight: 650; font-variant-numeric: tabular-nums; color: #fff; }
.gs-day-date { color: #c7d7f5; font-weight: 600; }
.gs-day-n, .gs-day-fee, .gs-day-recv { font-variant-numeric: tabular-nums; color: #9db4d8; }
.gs-day-recv { color: #6ee7b7; }
.gs-day-why { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.gs-day-bar { display: flex; height: 5px; border-radius: 999px; overflow: hidden; gap: 1px; background: rgba(255,255,255,.06); }
.gs-day-bar i { display: block; min-width: 2px; }
.gs-day-reason { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gs-day-go { color: #7d93b8; }
@media (max-width: 760px) {
  .gs-days-head { display: none; }
  .gs-day { grid-template-columns: 1fr auto; gap: 4px 10px; }
  .gs-day-n, .gs-day-fee, .gs-day-recv, .gs-day-go { display: none; }
  .gs-day-why { grid-column: 1 / -1; }
}
.gs-tip-why { max-width: 260px; white-space: normal; color: #fde68a; }
.gs-tip-cta { color: #93c5fd; font-size: 10.5px; }

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
