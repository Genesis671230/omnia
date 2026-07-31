"use client";

/* Warehouse cockpit — every SKU × every warehouse × every storefront in one
   founder-facing panel, backed by /api/inventory/warehouse-matrix.
   Read-only in this phase; write-back arrives in Phase 3 with STOCK_WRITE_MODE
   guardrails.

   What this answers (from data alone, no orders/history yet):
     - Which items sit where, in what quantity, across 7 warehouses
     - Which SKUs are at oversell risk / concentrated / stuck / mis-distributed
     - Which sellable warehouse has this SKU vs which is out of it
     - Which storefronts are listing more than a warehouse can actually ship

   What this DOES NOT do yet:
     - Real sell-through velocity (needs /api/inventory/velocity endpoint —
       call sites clearly labeled below as "TODO velocity")
     - Editable stock (Phase 3, needs stock_write_intents + STOCK_WRITE_MODE)
*/

import {
  Search, XCircle, Loader2, AlertTriangle, Ban, CheckCircle2, ShieldAlert, TrendingDown,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Sparkles, Warehouse, Store, Package,
  ArrowUpDown, Zap, TrendingUp, Layers, Target, Split, AlertCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

/* ── types (mirror the /api/inventory/warehouse-matrix response) ───────── */

type WarehouseCell = {
  warehouse_name: string;
  stock_on_hand: number;
  available_stock: number;
  actual_available_for_sale_stock: number;
  committed_stock: number;
  quantity_in_transit: number;
  is_item_mapped: boolean;
  is_primary: boolean;
};

type StorefrontCell = { quantity: number | null; product_status: string };

type MatrixRow = {
  item_id: string;
  sku: string;
  name: string;
  zoho_aggregate_stock: number;
  zoho_available_stock: number;
  warehouses: Record<string, WarehouseCell>;
  storefronts: Record<string, StorefrontCell>;
};

type WarehouseCol = {
  warehouse_id: string;
  warehouse_name: string;
  is_primary: boolean;
  is_sellable: boolean;
};

type ApiResponse = {
  rows: MatrixRow[];
  total: number;
  page: number;
  pageSize: number;
  warehouses: WarehouseCol[];
  kpis: {
    totalSkus: number;
    perWarehouse: {
      warehouse_id: string;
      warehouse_name: string;
      skus_with_stock: number;
      total_units: number;
      total_sellable_units: number;
    }[];
    perStorefront: {
      store_id: string;
      skus_listed: number;
      total_listed_units: number;
    }[];
  };
  insights: {
    totalRows: number;
    oversellRiskRows: number;
    hasStockButNoneSellableRows: number;
    storefrontExceedsSellableRows: number;
    averageHealth: number;
    worstOffenders: { sku: string; name: string; score: number; reasons: string[] }[];
  };
};

type CellStatus = "oversell_risk" | "out" | "critical" | "low" | "ok" | "not_carried";

/* ── same classifier as the server (kept in sync manually — server is
   authoritative but the client mirror keeps cell renders instant when
   filtering client-side without a round trip) ─────────────────────────── */

const CRITICAL_MAX = 3;
const LOW_MAX = 10;
const OPERATIONAL = new Set([
  "KSA Quarantine", "PRMNT DMG", "Damage-Awaiting Repair",
  "Modeling, Photoshoot, Temporary Usage", "Omnia, Gifts, etc",
]);
const isSellable = (name: string) => !OPERATIONAL.has(name);

function classifyCell(w: WarehouseCell | undefined, storefronts: Record<string, StorefrontCell>): CellStatus {
  if (!w || !w.is_item_mapped) return "not_carried";
  const s = w.actual_available_for_sale_stock ?? 0;
  if (isSellable(w.warehouse_name) && s <= 0) {
    const anyListed = Object.values(storefronts).some((sf) => typeof sf.quantity === "number" && sf.quantity > 0);
    if (anyListed) return "oversell_risk";
  }
  if (s <= 0) return "out";
  if (s <= CRITICAL_MAX) return "critical";
  if (s <= LOW_MAX) return "low";
  return "ok";
}

/* ── synthesized forecast signals — the "insights" Fouad opens the panel
   for. All computed from CURRENT snapshot, no historical data required.
   Each signal is a distinct actionable observation. ────────────────────── */

type ForecastSignal = {
  kind: "concentration" | "distribution_gap" | "dead_stock" | "oversell" | "storefront_imbalance" | "in_transit";
  severity: "high" | "medium" | "low";
  label: string;
  detail: string;
};

function computeForecastSignals(row: MatrixRow, storeIds: string[]): ForecastSignal[] {
  const signals: ForecastSignal[] = [];
  const sellableCells = Object.values(row.warehouses).filter((w) => isSellable(w.warehouse_name) && w.is_item_mapped);
  const totalSellable = sellableCells.reduce((s, w) => s + (w.actual_available_for_sale_stock ?? 0), 0);
  const totalOnHand = Object.values(row.warehouses).reduce((s, w) => s + (w.stock_on_hand ?? 0), 0);
  const totalListed = Object.values(row.storefronts).reduce((s, sf) => s + (typeof sf.quantity === "number" ? sf.quantity : 0), 0);
  const inTransit = Object.values(row.warehouses).reduce((s, w) => s + (w.quantity_in_transit ?? 0), 0);

  // Concentration: 100% of sellable stock in ONE warehouse (single-point-of-failure)
  const sellableWithStock = sellableCells.filter((w) => w.actual_available_for_sale_stock > 0);
  if (sellableWithStock.length === 1 && totalSellable >= 5) {
    signals.push({
      kind: "concentration", severity: "medium",
      label: "Single-warehouse concentration",
      detail: `All ${totalSellable} sellable units in ${sellableWithStock[0].warehouse_name}. Any disruption at that location = full stockout.`,
    });
  }

  // Distribution gap: KSA warehouse has stock but no KSA storefront listing
  const smsaCell = Object.values(row.warehouses).find((w) => w.warehouse_name === "SMSA Fulfillment KSA");
  if (smsaCell && smsaCell.actual_available_for_sale_stock > 0) {
    const ksaListing = row.storefronts["KSA"]?.quantity ?? 0;
    if (ksaListing === 0) {
      signals.push({
        kind: "distribution_gap", severity: "high",
        label: "KSA stock, not listed on KSA storefront",
        detail: `${smsaCell.actual_available_for_sale_stock} units at SMSA KSA, but Shopify KSA has this SKU at 0 or unlisted. Missed revenue.`,
      });
    }
  }

  // Dead stock: units on hand but 0 sellable anywhere
  if (totalOnHand > 3 && totalSellable === 0) {
    signals.push({
      kind: "dead_stock", severity: "medium",
      label: "Dead stock: on hand but not sellable",
      detail: `${totalOnHand} units on hand across warehouses, but 0 sellable — stuck in quarantine, damage, or committed.`,
    });
  }

  // Oversell exposure: storefronts listing more than sellable
  if (totalListed > totalSellable && totalListed > 0) {
    const gap = totalListed - totalSellable;
    signals.push({
      kind: "oversell", severity: gap > 5 ? "high" : "medium",
      label: `Oversell exposure: ${gap}-unit gap`,
      detail: `Storefronts collectively list ${totalListed} units for sale, warehouses can only fulfill ${totalSellable}. Next ${gap} orders will fail.`,
    });
  }

  // Storefront imbalance: heavily listed on one store, absent on another with stock present
  const uaeListing = row.storefronts["UAE"]?.quantity ?? 0;
  const ksaListing = row.storefronts["KSA"]?.quantity ?? 0;
  const waListing = row.storefronts["WA"]?.quantity ?? 0;
  if (uaeListing > 5 && ksaListing === 0 && smsaCell && smsaCell.actual_available_for_sale_stock > 0) {
    signals.push({
      kind: "storefront_imbalance", severity: "medium",
      label: "Storefront imbalance UAE vs KSA",
      detail: `Listed heavily on Shopify UAE (${uaeListing}) but absent from Shopify KSA despite ${smsaCell.actual_available_for_sale_stock} units in KSA.`,
    });
  }

  // In-transit signal: units en route worth surfacing (replenishment coming)
  if (inTransit > 0 && totalSellable <= 3) {
    signals.push({
      kind: "in_transit", severity: "low",
      label: "Replenishment in transit",
      detail: `${inTransit} units en route. Currently at ${totalSellable} sellable — hold off on emergency reorders.`,
    });
  }

  return signals;
}

/* ── main panel ─────────────────────────────────────────────────────────── */

export function WarehouseMatrixPanel() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // controls
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState(""); // debounced
  const [sortKey, setSortKey] = useState<"sku" | "name" | "zoho_aggregate_stock">("sku");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showOperational, setShowOperational] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "has_stock" | "signals_only">("all");
  const [expandedSku, setExpandedSku] = useState<string | null>(null);

  // debounce search input → committed search
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortKey,
        sortDir,
        ...(search ? { search } : {}),
      });
      const res = await fetch(`/api/inventory/warehouse-matrix?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      toast.error(`Failed to load warehouse matrix: ${(e as Error).message}`);
    } finally { setLoading(false); }
  }, [page, pageSize, sortKey, sortDir, search]);

  useEffect(() => { load(); }, [load]);

  const rows = data?.rows ?? [];
  const warehouses = data?.warehouses ?? [];
  const sellableWhs = warehouses.filter((w) => w.is_sellable);
  const operationalWhs = warehouses.filter((w) => !w.is_sellable);
  const visibleWhs = showOperational ? warehouses : sellableWhs;
  const storeIds = ["UAE", "KSA", "WA", "WOO"];

  // client-side filter over the current page. `has_stock` and `signals_only`
  // narrow what's shown WITHOUT changing pagination totals — clean signal
  // for the founder that "of the 50 on this page, X have live signals."
  const filteredRows = useMemo(() => {
    if (filterMode === "all") return rows;
    if (filterMode === "has_stock") {
      return rows.filter((r) => Object.values(r.warehouses).some((w) => w.stock_on_hand > 0));
    }
    // signals_only
    return rows.filter((r) => computeForecastSignals(r, storeIds).length > 0);
  }, [rows, filterMode]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const toggleSort = (k: typeof sortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
    setPage(1);
  };

  return (
    <div className="wm-panel">
      <style>{WM_CSS}</style>

      {/* ── KPI strip: totals + per-warehouse + per-storefront ─────────── */}
      <KpiStrip data={data} loading={loading && !data} />

      {/* ── two-column layout: table + insights sidebar ──────────────────  */}
      <div className="wm-grid">
        <div className="wm-main">
          <FilterToolbar
            searchInput={searchInput} setSearchInput={setSearchInput}
            filterMode={filterMode} setFilterMode={setFilterMode}
            showOperational={showOperational} setShowOperational={setShowOperational}
            resultCount={filteredRows.length} pageTotal={total}
          />

          {loading && !data ? (
            <div className="wm-empty"><Loader2 className="spin" size={20} /> Loading matrix…</div>
          ) : filteredRows.length === 0 ? (
            <div className="wm-empty">No SKUs match the current filter on this page. Try clearing filters or navigating pages.</div>
          ) : (
            <div className="wm-table-wrap">
              <table className="wm-table">
                <thead>
                  <tr>
                    <th className="sticky-l w-icon"></th>
                    <th className="sticky-l w-sku sortable" onClick={() => toggleSort("sku")}>
                      SKU {sortKey === "sku" && (sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                    </th>
                    <th className="sticky-l-2 w-name sortable" onClick={() => toggleSort("name")}>
                      Name {sortKey === "name" && (sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                    </th>
                    <th className="num sortable" onClick={() => toggleSort("zoho_aggregate_stock")}>
                      Zoho total {sortKey === "zoho_aggregate_stock" && (sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                    </th>

                    {sellableWhs.map((w) => (
                      <th key={w.warehouse_id} className="num wh-col sellable" title={w.warehouse_name}>
                        {w.is_primary && <span className="wh-primary-dot" />}
                        {shortName(w.warehouse_name)}
                      </th>
                    ))}

                    {showOperational && operationalWhs.map((w) => (
                      <th key={w.warehouse_id} className="num wh-col operational" title={w.warehouse_name}>
                        {shortName(w.warehouse_name)}
                      </th>
                    ))}

                    <th className="col-divider"></th>

                    {storeIds.map((s) => (
                      <th key={s} className="num store-col" title={`Shopify/Woo store: ${s}`}>{s}</th>
                    ))}

                    <th className="num signals-col">Signals</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row,i) => {
                    const signals = computeForecastSignals(row, storeIds);
                    const isExpanded = expandedSku === row.sku;
                    return (
                        <>
                        <tr key={row.sku} className={`wm-row ${signals.length > 0 ? "has-signals" : ""} ${isExpanded ? "expanded" : ""}`}
                          onClick={() => setExpandedSku(isExpanded ? null : row.sku)}>
                          <td className="sticky-l w-icon">
                            {isExpanded ? <ChevronUp size={13} className="chev" /> : <ChevronDown size={13} className="chev" />}
                          </td>
                          <td className="sticky-l w-sku mono">{row.sku}</td>
                          <td className="sticky-l-2 w-name" title={row.name}>{truncate(row.name, 42)}</td>
                          <td className="num mono zoho-total">
                            <span className={row.zoho_aggregate_stock <= 0 ? "zero" : row.zoho_aggregate_stock <= LOW_MAX ? "low" : ""}>
                              {row.zoho_aggregate_stock}
                            </span>
                          </td>

                          {sellableWhs.map((w) => (
                            <td key={w.warehouse_id} className="num">
                              <Cell w={row.warehouses[w.warehouse_id]} storefronts={row.storefronts} />
                            </td>
                          ))}

                          {showOperational && operationalWhs.map((w) => (
                            <td key={w.warehouse_id} className="num op">
                              <Cell w={row.warehouses[w.warehouse_id]} storefronts={row.storefronts} muted />
                            </td>
                          ))}

                          <td className="col-divider"></td>

                          {storeIds.map((s) => {
                            const sf = row.storefronts[s];
                            if (!sf || sf.quantity === null) return <td key={s} className="num"><span className="na">·</span></td>;
                            return <td key={s} className="num"><span className={`sf-qty ${sf.quantity <= 0 ? "zero" : ""}`}>{sf.quantity}</span></td>;
                          })}

                          <td className="num signals-cell">
                            {signals.length > 0 ? (
                              <span className={`signal-count sev-${maxSeverity(signals)}`}>
                                {signals.length}
                              </span>
                            ) : <span className="na">·</span>}
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr key={`${row.sku}-detail`} className="wm-detail-row">
                            <td colSpan={5 + visibleWhs.length + 1 + storeIds.length + 1}>
                              <RowDetail row={row} warehouses={warehouses} signals={signals} storeIds={storeIds} />
                            </td>
                          </tr>
                        )}
                      </>

                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} />
        </div>

        <InsightsSidebar data={data} />
      </div>
    </div>
  );
}

/* ── KPI strip ──────────────────────────────────────────────────────────── */

function KpiStrip({ data, loading }: { data: ApiResponse | null; loading: boolean }) {
  if (loading) return <div className="wm-empty small"><Loader2 className="spin" size={16} /> Loading KPIs…</div>;
  if (!data) return null;

  const sellableWhs = data.kpis.perWarehouse.filter((w) => !OPERATIONAL.has(w.warehouse_name));
  const opWhs = data.kpis.perWarehouse.filter((w) => OPERATIONAL.has(w.warehouse_name));
  const totalSellable = sellableWhs.reduce((s, w) => s + w.total_sellable_units, 0);
  const totalOperational = opWhs.reduce((s, w) => s + w.total_units, 0);
  const totalListed = data.kpis.perStorefront.reduce((s, sf) => s + sf.total_listed_units, 0);

  return (
    <div className="wm-kpi-wrap">
      <div className="wm-kpi-row">
        <KpiCard icon={<Package size={13} />} label="SKUs tracked" value={data.kpis.totalSkus.toLocaleString()} sub="Zoho catalog" />
        <KpiCard icon={<Warehouse size={13} />} label="Sellable units" value={totalSellable.toLocaleString()} sub={`Across ${sellableWhs.length} real warehouses`} tone="ok" />
        <KpiCard icon={<Layers size={13} />} label="Operational stock" value={totalOperational.toLocaleString()} sub="Quarantine, damage, gifts" tone="muted" />
        <KpiCard icon={<Store size={13} />} label="Storefront listings" value={totalListed.toLocaleString()} sub={`Across ${data.kpis.perStorefront.length} storefronts`} />
        <KpiCard icon={<Sparkles size={13} />} label="Avg. health" value={`${data.insights.averageHealth}%`}
          sub={`${data.insights.oversellRiskRows} oversell / ${data.insights.storefrontExceedsSellableRows} gap on page`}
          tone={data.insights.averageHealth >= 80 ? "ok" : data.insights.averageHealth >= 50 ? "warn" : "danger"} />
      </div>

      <div className="wm-kpi-sub">
        <div className="wh-strip">
          <span className="strip-label"><Warehouse size={12} /> Per warehouse</span>
          {sellableWhs.map((w) => (
            <div key={w.warehouse_id} className="wh-chip sellable">
              <span className="chip-name">{shortName(w.warehouse_name)}</span>
              <span className="chip-val">{w.total_sellable_units.toLocaleString()}</span>
              <span className="chip-sub">{w.skus_with_stock} SKUs</span>
            </div>
          ))}
          {opWhs.map((w) => w.total_units > 0 && (
            <div key={w.warehouse_id} className="wh-chip operational">
              <span className="chip-name">{shortName(w.warehouse_name)}</span>
              <span className="chip-val">{w.total_units.toLocaleString()}</span>
              <span className="chip-sub">{w.skus_with_stock} SKUs</span>
            </div>
          ))}
        </div>

        <div className="wh-strip">
          <span className="strip-label"><Store size={12} /> Per storefront</span>
          {data.kpis.perStorefront.map((sf) => (
            <div key={sf.store_id} className="wh-chip storefront">
              <span className="chip-name">{sf.store_id}</span>
              <span className="chip-val">{sf.total_listed_units.toLocaleString()}</span>
              <span className="chip-sub">{sf.skus_listed.toLocaleString()} SKUs</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone?: "ok" | "warn" | "danger" | "muted" }) {
  return (
    <div className={`wm-kpi ${tone ?? ""}`}>
      <span className="wm-kpi-label">{icon} {label}</span>
      <b>{value}</b>
      <em>{sub}</em>
    </div>
  );
}

/* ── filter toolbar ─────────────────────────────────────────────────────── */

function FilterToolbar({
  searchInput, setSearchInput, filterMode, setFilterMode, showOperational, setShowOperational,
  resultCount, pageTotal,
}: {
  searchInput: string; setSearchInput: (s: string) => void;
  filterMode: "all" | "has_stock" | "signals_only"; setFilterMode: (m: "all" | "has_stock" | "signals_only") => void;
  showOperational: boolean; setShowOperational: (b: boolean) => void;
  resultCount: number; pageTotal: number;
}) {
  return (
    <div className="wm-toolbar">
      <div className="search-wrap">
        <Search size={14} />
        <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search SKU or name…" className="search" />
        {searchInput && <button className="clear" onClick={() => setSearchInput("")}><XCircle size={13} /></button>}
      </div>

      <div className="seg">
        <button className={filterMode === "all" ? "on" : ""} onClick={() => setFilterMode("all")}>All ({resultCount})</button>
        <button className={filterMode === "has_stock" ? "on" : ""} onClick={() => setFilterMode("has_stock")}>Has stock</button>
        <button className={filterMode === "signals_only" ? "on" : ""} onClick={() => setFilterMode("signals_only")}>
          <AlertCircle size={11} /> With signals
        </button>
      </div>

      <label className="toggle">
        <input type="checkbox" checked={showOperational} onChange={(e) => setShowOperational(e.target.checked)} />
        Show operational warehouses
      </label>

      <span className="wm-count">{pageTotal.toLocaleString()} total</span>
    </div>
  );
}

/* ── one warehouse cell ─────────────────────────────────────────────────── */

function Cell({ w, storefronts, muted }: { w?: WarehouseCell; storefronts: Record<string, StorefrontCell>; muted?: boolean }) {
  const status = classifyCell(w, storefronts);
  if (status === "not_carried") return <span className="na">·</span>;
  const q = w!.actual_available_for_sale_stock;
  const cls = ["cell-qty", status, muted ? "muted" : ""].join(" ");
  const tip = `${w!.warehouse_name}: ${q} sellable (${w!.stock_on_hand} on hand${w!.committed_stock ? `, ${w!.committed_stock} committed` : ""}${w!.quantity_in_transit ? `, ${w!.quantity_in_transit} in transit` : ""})`;
  return <span className={cls} title={tip}>{q}</span>;
}

/* ── expanded row detail ────────────────────────────────────────────────── */

function RowDetail({ row, warehouses, signals, storeIds }: {
  row: MatrixRow; warehouses: WarehouseCol[]; signals: ForecastSignal[]; storeIds: string[];
}) {
  const totalOnHand = Object.values(row.warehouses).reduce((s, w) => s + (w.stock_on_hand ?? 0), 0);
  const totalCommitted = Object.values(row.warehouses).reduce((s, w) => s + (w.committed_stock ?? 0), 0);
  const totalInTransit = Object.values(row.warehouses).reduce((s, w) => s + (w.quantity_in_transit ?? 0), 0);
  const totalListed = Object.values(row.storefronts).reduce((s, sf) => s + (typeof sf.quantity === "number" ? sf.quantity : 0), 0);
  const totalSellable = Object.values(row.warehouses).reduce((s, w) => isSellable(w.warehouse_name) ? s + w.actual_available_for_sale_stock : s, 0);

  return (
    <div className="detail-grid">
      <div className="detail-block">
        <div className="detail-title"><Target size={12} /> Position</div>
        <div className="detail-stat"><b>{totalOnHand}</b><em>on hand across all</em></div>
        <div className="detail-stat"><b>{totalSellable}</b><em>truly sellable</em></div>
        <div className="detail-stat"><b>{totalCommitted}</b><em>committed to orders</em></div>
        <div className="detail-stat"><b>{totalInTransit}</b><em>in transit (replenishing)</em></div>
      </div>

      <div className="detail-block">
        <div className="detail-title"><Warehouse size={12} /> All warehouses</div>
        <div className="detail-wh-grid">
          {warehouses.map((w) => {
            const c = row.warehouses[w.warehouse_id];
            if (!c) return null;
            return (
              <div key={w.warehouse_id} className={`detail-wh ${w.is_sellable ? "sellable" : "operational"}`}>
                <span className="wh-name">{w.warehouse_name}</span>
                <span className="wh-nums">
                  <span className="n-main">{c.actual_available_for_sale_stock}</span>
                  <span className="n-sub">sellable</span>
                  {c.committed_stock > 0 && <span className="n-tag">−{c.committed_stock} committed</span>}
                  {c.quantity_in_transit > 0 && <span className="n-tag transit">+{c.quantity_in_transit} in transit</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="detail-block">
        <div className="detail-title"><Store size={12} /> Storefront listings</div>
        <div className="detail-stat"><b>{totalListed}</b><em>total listed across storefronts</em></div>
        <div className="detail-stat">
          <b className={totalListed > totalSellable ? "warn-text" : ""}>{Math.max(0, totalListed - totalSellable)}</b>
          <em>oversell exposure</em>
        </div>
        <div className="detail-sf-grid">
          {storeIds.map((s) => {
            const sf = row.storefronts[s];
            const q = sf?.quantity;
            return (
              <div key={s} className={`detail-sf ${q === null || q === undefined ? "not-listed" : q <= 0 ? "zero" : ""}`}>
                <span className="sf-name">{s}</span>
                <span className="sf-q">{q ?? "—"}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="detail-block signals">
        <div className="detail-title"><Sparkles size={12} /> Forecast signals</div>
        {signals.length === 0 ? (
          <div className="quiet">No adverse signals detected — SKU is healthy across current snapshot.</div>
        ) : (
          <div className="signal-list">
            {signals.map((sig, i) => (
              <div key={i} className={`signal sev-${sig.severity}`}>
                <div className="sig-head">
                  {sig.kind === "oversell" ? <ShieldAlert size={12} /> :
                   sig.kind === "distribution_gap" ? <Split size={12} /> :
                   sig.kind === "concentration" ? <Target size={12} /> :
                   sig.kind === "dead_stock" ? <Ban size={12} /> :
                   sig.kind === "in_transit" ? <TrendingUp size={12} /> :
                   <AlertTriangle size={12} />}
                  {sig.label}
                </div>
                <div className="sig-detail">{sig.detail}</div>
              </div>
            ))}
          </div>
        )}
        <div className="velocity-slot">
          <Zap size={11} /> <em>Real sell-through velocity requires /api/inventory/velocity endpoint (Phase 2 — connect orders table with warehouse allocation to activate).</em>
        </div>
      </div>
    </div>
  );
}

/* ── insights sidebar ──────────────────────────────────────────────────── */

function InsightsSidebar({ data }: { data: ApiResponse | null }) {
  if (!data) return <aside className="wm-side"></aside>;
  const { insights } = data;

  return (
    <aside className="wm-side">
      <div className="side-title"><Sparkles size={13} /> Live insights</div>

      <div className="side-stat-grid">
        <div className="side-stat danger"><b>{insights.oversellRiskRows}</b><em>oversell risk (this page)</em></div>
        <div className="side-stat warn"><b>{insights.storefrontExceedsSellableRows}</b><em>storefront exceeds sellable</em></div>
        <div className="side-stat"><b>{insights.hasStockButNoneSellableRows}</b><em>stuck (on hand, not sellable)</em></div>
        <div className="side-stat"><b>{insights.averageHealth}%</b><em>avg health this page</em></div>
      </div>

      <div className="side-block">
        <div className="side-block-title">Worst offenders on this page</div>
        {insights.worstOffenders.length === 0 ? (
          <div className="quiet small">Every SKU on this page is above 80% health.</div>
        ) : (
          <div className="offender-list">
            {insights.worstOffenders.map((o) => (
              <div key={o.sku} className="offender">
                <div className="off-head">
                  <span className="mono">{o.sku}</span>
                  <span className={`off-score ${o.score < 30 ? "danger" : o.score < 60 ? "warn" : ""}`}>{o.score}</span>
                </div>
                <div className="off-name" title={o.name}>{truncate(o.name, 40)}</div>
                <div className="off-reasons">
                  {o.reasons.map((r, i) => <div key={i} className="reason">• {r}</div>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="side-block hint">
        <div className="side-block-title"><Zap size={11} /> Coming next</div>
        <div className="quiet small">
          Real sell-through velocity (units/day per SKU per warehouse) will replace the current snapshot-only signals.
          Needs orders table joined with warehouse allocation — that's Phase 2.
        </div>
      </div>
    </aside>
  );
}

/* ── pagination ────────────────────────────────────────────────────────── */

function Pagination({ page, setPage, totalPages, total, pageSize }: {
  page: number; setPage: (p: number) => void; totalPages: number; total: number; pageSize: number;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="wm-pager">
      <span className="pager-info">{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</span>
      <div className="pager-controls">
        <button disabled={page === 1} onClick={() => setPage(1)}>«</button>
        <button disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={13} /></button>
        <span className="pager-page">Page {page} of {totalPages}</span>
        <button disabled={page === totalPages} onClick={() => setPage(page + 1)}><ChevronRight size={13} /></button>
        <button disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
      </div>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────────────────── */

function shortName(name: string): string {
  const map: Record<string, string> = {
    "Omniastores LLC": "Omnia UAE",
    "SMSA Fulfillment KSA": "SMSA KSA",
    "KSA Quarantine": "Quarantine",
    "PRMNT DMG": "Damaged",
    "Damage-Awaiting Repair": "Awaiting Repair",
    "Modeling, Photoshoot, Temporary Usage": "Photo/Temp",
    "Omnia, Gifts, etc": "Gifts",
  };
  return map[name] ?? name;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function maxSeverity(signals: ForecastSignal[]): "high" | "medium" | "low" {
  if (signals.some((s) => s.severity === "high")) return "high";
  if (signals.some((s) => s.severity === "medium")) return "medium";
  return "low";
}

/* ── styles (matches the existing InventoryPanel palette) ──────────────── */

const WM_CSS = `
  .wm-panel { display: flex; flex-direction: column; gap: 16px; margin-top: 20px; font-size: 13px; }
  .wm-panel * { box-sizing: border-box; }
  .mono { font-variant-numeric: tabular-nums; }
  .num { text-align: right; }
  .spin { animation: wmspin 1s linear infinite; } @keyframes wmspin { to { transform: rotate(360deg); } }
  .quiet { color: var(--muted); }
  .quiet.small { font-size: 12px; }
  .na { color: var(--line); }
  .warn-text { color: #b56a15; }

  /* KPI strip */
  .wm-kpi-wrap { display: flex; flex-direction: column; gap: 10px; }
  .wm-kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .wm-kpi { position: relative; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: var(--card); display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
  .wm-kpi b { font-size: 22px; font-weight: 600; line-height: 1.1; }
  .wm-kpi-label { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); }
  .wm-kpi em { font-size: 10.5px; color: var(--muted); font-style: normal; }
  .wm-kpi::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: transparent; }
  .wm-kpi.ok::before { background: #4b9e7a; } .wm-kpi.ok b { color: #3d8262; }
  .wm-kpi.warn::before { background: #d98324; } .wm-kpi.warn b { color: #b56a15; }
  .wm-kpi.danger::before { background: #c0392b; } .wm-kpi.danger b { color: #c0392b; }
  .wm-kpi.muted { opacity: 0.75; }

  .wm-kpi-sub { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
  .wh-strip { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .strip-label { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin-right: 4px; }
  .wh-chip { display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 10px; border-radius: 999px; background: var(--gold-wash); color: var(--gold-deep); font-size: 12px; font-weight: 600; }
  .wh-chip.sellable { background: rgba(75,158,122,.12); color: #3d8262; }
  .wh-chip.operational { background: rgba(0,0,0,.06); color: var(--muted); }
  .wh-chip.storefront { background: var(--gold-wash); color: var(--gold-deep); }
  .chip-name { font-weight: 600; }
  .chip-val { font-variant-numeric: tabular-nums; font-weight: 700; }
  .chip-sub { font-size: 10.5px; opacity: 0.7; font-weight: 500; }

  /* two-column grid: table + sidebar */
  .wm-grid { display: grid; grid-template-columns: 1fr 300px; gap: 16px; align-items: start; }
  @media (max-width: 1200px) { .wm-grid { grid-template-columns: 1fr; } }
  .wm-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

  /* toolbar */
  .wm-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
  .search-wrap { position: relative; display: flex; align-items: center; gap: 8px; flex: 1; min-width: 220px; padding: 5px 10px; border: 1px solid var(--line); border-radius: 8px; color: var(--muted); background: var(--bg, transparent); }
  .search-wrap:focus-within { border-color: var(--gold); }
  .search { border: none; background: transparent; outline: none; font-family: inherit; font-size: 13px; color: var(--ink); width: 100%; }
  .clear { border: none; background: none; color: var(--muted); cursor: pointer; display: flex; }
  .seg { display: inline-flex; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 2px; }
  .seg button { border: none; background: none; font-family: inherit; font-size: 12px; font-weight: 500; color: var(--muted); padding: 5px 10px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
  .seg button.on { background: var(--ink); color: var(--card); }
  .toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); cursor: pointer; }
  .toggle input { accent-color: var(--gold); }
  .wm-count { margin-left: auto; font-size: 11.5px; color: var(--muted); }

  /* table */
  .wm-empty { padding: 40px; text-align: center; color: var(--muted); display: flex; flex-direction: column; align-items: center; gap: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
  .wm-empty.small { padding: 12px; flex-direction: row; }
  .wm-table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
  .wm-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
  .wm-table th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 8px 6px; border-bottom: 1px solid var(--line); white-space: nowrap; background: var(--card); position: sticky; top: 0; z-index: 2; font-weight: 600; }
  .wm-table th.sortable { cursor: pointer; user-select: none; }
  .wm-table th.sortable:hover { color: var(--ink); }
  .wm-table th.num { text-align: right; }
  .wm-table td { padding: 7px 6px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .wm-table tr.wm-row { cursor: pointer; }
  .wm-table tr.wm-row:hover { background: var(--gold-wash); }
  .wm-table tr.wm-row.has-signals { background: linear-gradient(90deg, rgba(192,57,43,.03), transparent 30%); }
  .wm-table tr.wm-row.expanded { background: var(--gold-wash); }
  .chev { color: var(--muted); }

  .sticky-l { position: sticky; left: 0; background: var(--card); z-index: 1; }
  .sticky-l-2 { position: sticky; left: 96px; background: var(--card); z-index: 1; }
  .wm-row:hover .sticky-l, .wm-row:hover .sticky-l-2, .wm-row.expanded .sticky-l, .wm-row.expanded .sticky-l-2 { background: var(--gold-wash); }
  .w-icon { width: 24px; padding-left: 10px !important; }
  .w-sku { width: 96px; min-width: 96px; }
  .w-name { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .wh-col.sellable { color: #3d8262; font-weight: 700; }
  .wh-col.operational { color: var(--muted); }
  .wh-primary-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--gold); margin-right: 4px; }
  .col-divider { width: 1px; padding: 0 !important; border-left: 1px solid var(--line); background: transparent !important; }
  .store-col { color: var(--gold-deep); font-weight: 700; }
  .signals-col { color: var(--muted); }

  .zoho-total .zero { color: #8a6240; }
  .zoho-total .low { color: #b56a15; }

  .cell-qty { display: inline-block; padding: 1px 6px; border-radius: 5px; font-variant-numeric: tabular-nums; font-weight: 600; }
  .cell-qty.ok { color: #3d8262; }
  .cell-qty.low { color: #b56a15; background: rgba(224,184,76,.12); }
  .cell-qty.critical { color: #b56a15; background: rgba(217,131,36,.15); font-weight: 700; }
  .cell-qty.out { color: #8a6240; }
  .cell-qty.oversell_risk { color: #c0392b; background: rgba(192,57,43,.12); font-weight: 700; }
  .cell-qty.muted { opacity: 0.6; }

  .sf-qty { font-variant-numeric: tabular-nums; }
  .sf-qty.zero { color: #8a6240; font-weight: 600; }

  .signal-count { display: inline-block; min-width: 22px; padding: 2px 6px; border-radius: 999px; font-weight: 700; font-size: 11px; font-variant-numeric: tabular-nums; }
  .signal-count.sev-high { background: #c0392b; color: white; }
  .signal-count.sev-medium { background: #d98324; color: white; }
  .signal-count.sev-low { background: var(--muted); color: white; opacity: 0.7; }

  /* detail row */
  .wm-detail-row td { background: var(--gold-wash); padding: 16px; border-bottom: 2px solid var(--gold); }
  .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
  .detail-block { display: flex; flex-direction: column; gap: 6px; }
  .detail-title { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; margin-bottom: 4px; }
  .detail-stat { display: flex; align-items: baseline; gap: 8px; }
  .detail-stat b { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .detail-stat em { font-size: 11.5px; color: var(--muted); font-style: normal; }
  .detail-wh-grid { display: flex; flex-direction: column; gap: 4px; }
  .detail-wh { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-radius: 6px; font-size: 12px; }
  .detail-wh.sellable { background: rgba(75,158,122,.08); }
  .detail-wh.operational { background: rgba(0,0,0,.03); opacity: 0.7; }
  .wh-name { font-weight: 600; }
  .wh-nums { display: inline-flex; align-items: baseline; gap: 6px; font-variant-numeric: tabular-nums; }
  .n-main { font-size: 15px; font-weight: 700; }
  .n-sub { font-size: 10.5px; color: var(--muted); }
  .n-tag { font-size: 10.5px; padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,.06); }
  .n-tag.transit { background: rgba(75,158,122,.15); color: #3d8262; }

  .detail-sf-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 6px; }
  .detail-sf { display: flex; flex-direction: column; align-items: center; padding: 6px; border-radius: 6px; background: rgba(0,0,0,.03); }
  .detail-sf.not-listed { opacity: 0.4; }
  .detail-sf.zero { background: rgba(192,57,43,.06); }
  .sf-name { font-size: 10.5px; text-transform: uppercase; color: var(--muted); letter-spacing: .06em; }
  .sf-q { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }

  .signal-list { display: flex; flex-direction: column; gap: 8px; }
  .signal { padding: 8px 10px; border-radius: 8px; background: white; border-left: 3px solid var(--muted); }
  .signal.sev-high { border-left-color: #c0392b; }
  .signal.sev-medium { border-left-color: #d98324; }
  .signal.sev-low { border-left-color: #4b9e7a; }
  .sig-head { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12px; margin-bottom: 3px; }
  .sig-detail { font-size: 11.5px; color: var(--muted); line-height: 1.4; }

  .velocity-slot { margin-top: 12px; padding: 8px 10px; border: 1px dashed var(--line); border-radius: 6px; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }

  /* sidebar */
  .wm-side { position: sticky; top: 20px; display: flex; flex-direction: column; gap: 12px; }
  .side-title { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; padding: 0 4px; }
  .side-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .side-stat { padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); display: flex; flex-direction: column; gap: 2px; }
  .side-stat b { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
  .side-stat em { font-size: 10.5px; color: var(--muted); font-style: normal; line-height: 1.2; }
  .side-stat.danger b { color: #c0392b; }
  .side-stat.warn b { color: #b56a15; }
  .side-block { padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); display: flex; flex-direction: column; gap: 8px; }
  .side-block-title { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; display: inline-flex; align-items: center; gap: 5px; }
  .side-block.hint { background: var(--gold-wash); border-color: var(--gold); }

  .offender-list { display: flex; flex-direction: column; gap: 10px; max-height: 400px; overflow-y: auto; }
  .offender { padding: 8px; border-radius: 6px; background: rgba(0,0,0,.03); display: flex; flex-direction: column; gap: 4px; }
  .off-head { display: flex; justify-content: space-between; align-items: center; }
  .off-score { padding: 1px 8px; border-radius: 999px; font-weight: 700; font-size: 11px; font-variant-numeric: tabular-nums; background: rgba(0,0,0,.08); }
  .off-score.warn { background: rgba(217,131,36,.15); color: #b56a15; }
  .off-score.danger { background: rgba(192,57,43,.15); color: #c0392b; }
  .off-name { font-size: 11.5px; color: var(--muted); }
  .off-reasons { font-size: 11px; color: var(--ink); display: flex; flex-direction: column; gap: 2px; }
  .reason { padding-left: 4px; }

  /* pagination */
  .wm-pager { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
  .pager-info { font-size: 11.5px; color: var(--muted); }
  .pager-controls { display: inline-flex; align-items: center; gap: 4px; }
  .pager-controls button { border: 1px solid var(--line); background: transparent; padding: 4px 8px; border-radius: 6px; cursor: pointer; color: var(--ink); font-size: 12px; display: inline-flex; align-items: center; }
  .pager-controls button:disabled { opacity: 0.35; cursor: not-allowed; }
  .pager-controls button:not(:disabled):hover { background: var(--gold-wash); }
  .pager-page { font-size: 11.5px; color: var(--muted); padding: 0 8px; }
`;