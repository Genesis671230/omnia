"use client";

/* Gross Sales strip for the Orders workspace.
   Today, yesterday, last 7 days, last 30 days, last calendar month, and the
   from/to range when one is picked.

   This answers a different question from the "Ledger on screen" banner below
   it. That banner sums the 50 rows currently on the page, so it moves when you
   paginate or filter; these are period totals over every order in the window,
   and they do not. Both are true, they just are not the same number, which is
   why the labels say so. */

import { useCallback, useEffect, useState } from "react";
import { Loader2, TrendingUp, TrendingDown, Minus, RefreshCw, CalendarRange } from "lucide-react";

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
type Report = {
  asOfDay: string;
  stores: string[];
  periods: Rollup[];
  custom: Rollup | null;
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

const C = {
  ink: "#1F1B16",
  dim: "#8A8175",
  faint: "#B5AC98",
  edge: "#EAE3D6",
  paper: "#FBF9F5",
  gold: "#B08343",
  up: "#3F7A52",
  down: "#B4524A",
};

const STORE_DOT: Record<string, string> = {
  UAE: "#5B8C6E",
  KSA: "#C2851A",
  WA: "#5C87B8",
  WOO: "#8B6FB0",
};

function money0(n: number): string {
  return n.toLocaleString("en-AE", { maximumFractionDigits: 0 });
}

export function GrossSalesStrip({
  store = "All",
  fromDate = "",
  toDate = "",
}: {
  store?: string;
  fromDate?: string;
  toDate?: string;
}) {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ days: "30" });
      if (store && store !== "All") p.set("store", store);
      // Only send a range when both ends are set; a half-open range would
      // otherwise be filled in server-side with a date nobody chose.
      if (fromDate && toDate) {
        p.set("from", fromDate);
        p.set("to", toDate);
      }
      const res = await fetch(`/api/orders/gross-sales?${p.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setData(json as Report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [store, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div style={S.shell}>
        <style>{CSS}</style>
        <div style={S.loading}>
          <Loader2 size={14} className="gss-spin" /> Reading gross sales…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={S.shell}>
        <style>{CSS}</style>
        <div style={S.loading}>
          <span>Gross Sales unavailable. {error}</span>
          <button type="button" className="gss-retry" onClick={() => void load()}>
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const tiles = data.custom ? [...data.periods, data.custom] : data.periods;
  const excludedTotal = data.excluded.unpaidOrders + data.excluded.cancelledOrders;

  return (
    <div style={{ ...S.shell, opacity: loading ? 0.6 : 1 }}>
      <style>{CSS}</style>

      <div style={S.head}>
        <span style={S.eyebrow}>Gross Sales</span>
        <span style={S.headNote}>
          paid orders · {store === "All" ? "all four stores" : store} · Dubai time
        </span>
      </div>

      <div className="gss-grid">
        {tiles.map((r) => {
          const open = openKey === r.key;
          return (
            <button
              key={r.key}
              type="button"
              className={`gss-tile${open ? " on" : ""}${r.key === "custom" ? " custom" : ""}`}
              aria-expanded={open}
              onClick={() => setOpenKey(open ? null : r.key)}
            >
              <span className="gss-label">
                {r.key === "custom" && <CalendarRange size={10} />}
                {r.key === "today" ? "Today so far" : r.label}
              </span>
              <span className="gss-amount">
                <i>AED</i> {money0(r.grossAed)}
              </span>
              <span className="gss-orders">
                {r.orders.toLocaleString()} paid {r.orders === 1 ? "order" : "orders"}
              </span>
              <Delta rollup={r} />

              {open && (
                <span className="gss-stores">
                  {r.byStore.map((s) => (
                    <span key={s.store} className="gss-store">
                      <i style={{ background: STORE_DOT[s.store] ?? C.faint }} />
                      <b>{s.store}</b>
                      <em>
                        {money0(s.grossAed)}
                        <small> · {s.orders}</small>
                      </em>
                    </span>
                  ))}
                  <span className="gss-range">
                    {r.fromDay === r.toDay ? r.fromDay : `${r.fromDay} → ${r.toDay}`}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={S.foot}>
        <span>
          Paid orders at full order value, before gateway fees, refunds and VAT.
          Period totals, not the 50 rows on screen.
        </span>
        {excludedTotal > 0 && (
          <span>
            Last 30 days excludes {data.excluded.unpaidOrders.toLocaleString()} unpaid
            (AED {money0(data.excluded.unpaidGrossAed)}) and{" "}
            {data.excluded.cancelledOrders.toLocaleString()} cancelled or refunded
            (AED {money0(data.excluded.cancelledGrossAed)}).
          </span>
        )}
      </div>
    </div>
  );
}

function Delta({ rollup }: { rollup: Rollup }) {
  const { deltaPct, key } = rollup;
  const against =
    key === "today"
      ? "vs yesterday"
      : key === "yesterday"
        ? "vs the day before"
        : key === "lastMonth"
          ? "vs the month before"
          : key === "custom"
            ? "vs the same span before"
            : `vs previous ${key === "last7" ? "7" : "30"} days`;

  if (deltaPct === null) {
    return <span className="gss-delta flat">no prior {against.replace("vs ", "")}</span>;
  }
  const up = deltaPct > 0;
  const flat = deltaPct === 0;
  return (
    <span className={`gss-delta ${flat ? "flat" : up ? "up" : "down"}`}>
      {flat ? <Minus size={10} /> : up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {up ? "+" : ""}
      {deltaPct}% {against}
      {key === "today" && <small> · part day</small>}
    </span>
  );
}

const S: Record<string, React.CSSProperties> = {
  shell: { marginBottom: 18, transition: "opacity .2s" },
  head: { display: "flex", alignItems: "baseline", gap: 10, marginBottom: 9, flexWrap: "wrap" },
  eyebrow: {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    color: C.dim,
  },
  headNote: { fontSize: 11, color: C.faint },
  loading: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "14px 16px",
    fontSize: 12.5,
    color: C.dim,
    border: `1px solid ${C.edge}`,
    borderRadius: 14,
    background: "#fff",
  },
  foot: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    marginTop: 8,
    fontSize: 10.5,
    lineHeight: 1.5,
    color: C.faint,
  },
};

const CSS = `
@keyframes gss-spin { to { transform: rotate(360deg); } }
.gss-spin { animation: gss-spin 1s linear infinite; }

.gss-grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 900px)  { .gss-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 1280px) { .gss-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
/* With a custom range there are six tiles; keep the row even rather than
   orphaning one on its own line. */
@media (min-width: 1280px) { .gss-grid:has(.gss-tile.custom) { grid-template-columns: repeat(6, minmax(0, 1fr)); } }

.gss-tile {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  min-width: 0; padding: 12px 13px 11px; text-align: left; cursor: pointer;
  border: 1px solid ${C.edge}; border-radius: 14px; background: #fff;
  box-shadow: 0 1px 2px rgba(31,27,22,.04);
  transition: border-color .18s, box-shadow .18s, transform .18s;
}
.gss-tile:hover { border-color: #D6CCBA; box-shadow: 0 2px 8px rgba(31,27,22,.07); transform: translateY(-1px); }
.gss-tile.on { border-color: ${C.gold}; box-shadow: 0 2px 10px rgba(176,131,67,.14); }
.gss-tile:focus-visible { outline: 2px solid ${C.gold}; outline-offset: 2px; }
.gss-tile.custom { background: ${C.paper}; }

.gss-label {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 9.5px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
  color: ${C.dim}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
}
.gss-amount {
  font-family: 'Newsreader', Georgia, serif; font-size: 24px; line-height: 1.15;
  color: ${C.ink}; font-feature-settings: 'tnum'; white-space: nowrap;
}
.gss-amount i { font-size: 11px; font-style: italic; color: ${C.faint}; margin-right: 3px; }
.gss-orders { font-size: 10.5px; color: ${C.faint}; font-feature-settings: 'tnum'; }

.gss-delta {
  display: inline-flex; align-items: center; gap: 3px; margin-top: 4px;
  font-size: 10px; font-weight: 600; font-feature-settings: 'tnum';
}
.gss-delta small { font-weight: 500; opacity: .8; }
.gss-delta.up { color: ${C.up}; }
.gss-delta.down { color: ${C.down}; }
.gss-delta.flat { color: ${C.faint}; font-weight: 500; }

.gss-stores {
  display: flex; flex-direction: column; gap: 3px; width: 100%;
  margin-top: 9px; padding-top: 8px; border-top: 1px solid ${C.edge};
}
.gss-store { display: flex; align-items: center; gap: 6px; font-size: 10.5px; }
.gss-store i { width: 6px; height: 6px; border-radius: 999px; flex: none; }
.gss-store b { font-weight: 600; color: ${C.dim}; }
.gss-store em { margin-left: auto; font-style: normal; color: ${C.ink}; font-feature-settings: 'tnum'; }
.gss-store small { color: ${C.faint}; }
.gss-range { margin-top: 4px; font-size: 9.5px; color: ${C.faint}; font-feature-settings: 'tnum'; }

.gss-retry {
  display: inline-flex; align-items: center; gap: 5px; margin-left: auto;
  min-height: 30px; padding: 0 10px; font-size: 11.5px; cursor: pointer;
  border: 1px solid ${C.edge}; border-radius: 8px; background: #fff; color: ${C.ink};
}
`;
