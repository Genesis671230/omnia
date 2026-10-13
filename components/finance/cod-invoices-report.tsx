"use client";

/* COD invoices — every cash-on-delivery order of a month next to its Zoho
   invoice (House of Omnia), its status there, the courier's voucher and what
   to do next. Each row opens the order's cancel / return / received dialog. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, RefreshCw, Search, Truck } from "lucide-react";
import { OrderAdjustDialog } from "@/components/finance/order-adjust-dialog";

type State = "with_courier" | "remitted_not_booked" | "partly_paid" | "no_invoice" | "paid" | "returned" | "cancelled";
type Row = {
  uid: string; order: string; day: string; store: string; customer: string; city: string; grossAed: number; storeStatus: string;
  invoice: { org: string; number: string; date: string; status: string; total: number; balance: number } | null;
  creditNotes: { number: string; total: number; status: string }[];
  courier: { status: string; voucher: string | null; bankDate: string | null; receivedAed: number } | null;
  adjustment: { kind: string; creditNote: string } | null;
  state: State; openAed: number; ageDays: number; action: string; flags: string[];
};
type Report = {
  month: string; asOf: string; homeOrg: string; zohoReadAt: string; orgErrors: string[];
  totals: { orders: number; grossAed: number; invoicedAed: number; paidAed: number; openAed: number };
  byState: { state: State; label: string; orders: number; grossAed: number; openAed: number }[];
  openByAge: { band: string; orders: number; aed: number }[];
  flags: { flag: string; orders: string[] }[];
  rows: Row[];
};

const TONE: Record<State, { bg: string; fg: string }> = {
  with_courier: { bg: "#FEF3C7", fg: "#B45309" },
  remitted_not_booked: { bg: "#FFE4E6", fg: "#BE123C" },
  partly_paid: { bg: "#FEF3C7", fg: "#B45309" },
  no_invoice: { bg: "#FFE4E6", fg: "#BE123C" },
  paid: { bg: "#D1FAE5", fg: "#047857" },
  returned: { bg: "#EEF2FA", fg: "#46546F" },
  cancelled: { bg: "#EEF2FA", fg: "#46546F" },
};
const aed = (n: number) => `AED ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" }).slice(0, 7);
const monthsBack = (n: number) => {
  const [y, m] = thisMonth().split("-").map(Number);
  return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - i, 1)); return d.toISOString().slice(0, 7); });
};

export function CodInvoicesReport() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [state, setState] = useState<State | "open" | "all">("open");
  const [q, setQ] = useState("");
  const [adjusting, setAdjusting] = useState<Row | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (fresh = false) => {
    setLoading(true); setErr("");
    try {
      const res = await fetch(`/api/reports/cod-invoices?month=${month}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("json")) throw new Error(`HTTP ${res.status} — session may have expired`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setData(j);
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (data?.rows ?? []).filter((r) =>
      (state === "all" || (state === "open" ? r.openAed > 0 : r.state === state)) &&
      words.every((w) => [r.order, r.customer, r.city, r.invoice?.number, r.courier?.voucher, r.store].join(" ").toLowerCase().includes(w)));
  }, [data, state, q]);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/reports/cod-invoices?month=${month}&format=xlsx`);
      if (!res.ok || !(res.headers.get("content-type") || "").includes("spreadsheet")) throw new Error(`Export failed (HTTP ${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url; a.download = `cod-invoices-${month}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast.error((e as Error).message); } finally { setExporting(false); }
  };

  const openCount = data?.rows.filter((r) => r.openAed > 0).length ?? 0;
  return (
    <section className="codr">
      <style>{CSS}</style>
      <header>
        <div>
          <span className="codr-eyebrow"><Truck size={12} /> Cash on delivery · {data?.homeOrg ?? "House of Omnia"}</span>
          <h2>COD invoices</h2>
          <p>Each COD order, its Zoho invoice and status, whether the courier has paid it over, and what to do next.{data && <> Zoho read {new Date(data.zohoReadAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.</>}</p>
        </div>
        <div className="codr-actions">
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            {monthsBack(6).map((m) => <option key={m} value={m}>{new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</option>)}
          </select>
          <button onClick={() => load(true)} disabled={loading} title="Read Zoho again">{loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Refresh</button>
          <button onClick={exportXlsx} disabled={exporting || !data}>{exporting ? <Loader2 size={13} className="spin" /> : <Download size={13} />} .xlsx</button>
        </div>
      </header>

      {err && <div className="codr-err">{err}</div>}
      {data?.orgErrors.length ? <div className="codr-err">Zoho: {data.orgErrors.join("; ")}</div> : null}
      {!data && loading && <div className="codr-quiet"><Loader2 size={14} className="spin" /> Reading invoices from every Zoho organisation…</div>}

      {data && (
        <>
          <div className="codr-tiles">
            <div><span>COD orders</span><b>{data.totals.orders}</b><em>{aed(data.totals.grossAed)}</em></div>
            <div><span>Paid in Zoho</span><b>{aed(data.totals.paidAed)}</b><em>of {aed(data.totals.invoicedAed)} invoiced</em></div>
            <div className="hot"><span>Still open</span><b>{aed(data.totals.openAed)}</b><em>{openCount} orders</em></div>
            <div><span>Open by age</span>{data.openByAge.map((a) => <em key={a.band}>{a.band}: {a.orders} · {aed(a.aed)}</em>)}</div>
          </div>

          <div className="codr-states">
            <button className={state === "open" ? "on" : ""} onClick={() => setState("open")}>Needs action · {openCount}</button>
            {data.byState.map((b) => (
              <button key={b.state} className={state === b.state ? "on" : ""} onClick={() => setState(state === b.state ? "open" : b.state)} style={{ background: TONE[b.state].bg, color: TONE[b.state].fg }}>
                {b.label} · {b.orders}{b.openAed ? ` · ${aed(b.openAed)}` : ""}
              </button>
            ))}
            <button className={state === "all" ? "on" : ""} onClick={() => setState("all")}>All · {data.rows.length}</button>
          </div>

          {data.flags.length > 0 && (
            <div className="codr-flags">{data.flags.map((f) => <span key={f.flag} title={f.orders.join(", ")}>{f.flag}: {f.orders.slice(0, 6).join(", ")}{f.orders.length > 6 ? ` +${f.orders.length - 6}` : ""}</span>)}</div>
          )}

          <div className="codr-search"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, customer, city, invoice, voucher…" /></div>

          <div className="codr-table">
            <table>
              <thead><tr><th>Order</th><th>Customer</th><th>Order AED</th><th>Invoice</th><th>Zoho</th><th>Courier</th><th>State · action</th><th>Open</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.uid}>
                    <td><b>#{r.order}</b><div className="sub">{r.store} · {r.day}</div></td>
                    <td dir="auto">{r.customer}<div className="sub">{r.city}</div></td>
                    <td className="num">{aed(r.grossAed)}</td>
                    <td>{r.invoice ? <>{r.invoice.number}<div className="sub">{r.invoice.org === data.homeOrg ? r.invoice.date : `${r.invoice.org} · ${r.invoice.date}`}</div></> : <span className="miss">none</span>}</td>
                    <td>{r.invoice ? <>{r.invoice.status}<div className="sub">{r.invoice.balance > 0 ? `${aed(r.invoice.balance)} due` : "settled"}{r.creditNotes.length ? ` · ${r.creditNotes.map((c) => c.number).join(", ")}` : ""}</div></> : "—"}</td>
                    <td>{r.courier?.voucher ? <>{r.courier.voucher}<div className="sub">{r.courier.bankDate ? `bank ${r.courier.bankDate}` : "bank not matched"}</div></> : <span className="miss">no voucher</span>}</td>
                    <td><span className="pill" style={{ background: TONE[r.state].bg, color: TONE[r.state].fg }}>{data.byState.find((b) => b.state === r.state)?.label ?? r.state}</span>
                      {r.action && <div className="sub">{r.action}</div>}
                      {r.flags.length > 0 && <div className="sub warn">{r.flags.join(" · ")}</div>}</td>
                    <td className="num">{r.openAed ? <>{aed(r.openAed)}<div className="sub">{r.ageDays} days</div></> : "—"}</td>
                    <td><button className="act" onClick={() => setAdjusting(r)}>{r.adjustment ? "View" : "Close / cancel…"}</button></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} className="codr-quiet">Nothing here.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {adjusting && (
        <OrderAdjustDialog uid={adjusting.uid} orderNumber={adjusting.order} initialKind={adjusting.state === "remitted_not_booked" ? "received" : "cancelled"}
          onClose={() => setAdjusting(null)} onDone={() => load(true)} />
      )}
    </section>
  );
}

const CSS = `
  .codr { background: #fff; border: 1px solid #D8E1F1; border-radius: 18px; padding: 18px; margin-bottom: 18px; color: #0F1B3D; }
  .codr header { display: flex; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
  .codr-eyebrow { display: inline-flex; gap: 6px; align-items: center; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #5E6B85; font-weight: 700; }
  .codr h2 { margin: 4px 0; font-size: 20px; font-weight: 600; }
  .codr header p { margin: 0; font-size: 12.5px; color: #46546F; max-width: 560px; }
  .codr-actions { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; }
  .codr-actions select, .codr-actions button { height: 34px; border: 1px solid #D8E1F1; background: #fff; border-radius: 10px; padding: 0 10px; font-size: 12.5px; font-weight: 600; color: #0F1B3D; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .codr-err { background: #FFE4E6; color: #BE123C; border-radius: 10px; padding: 8px 12px; font-size: 13px; margin-bottom: 10px; }
  .codr-quiet { color: #5E6B85; font-size: 13px; padding: 12px; display: flex; gap: 8px; align-items: center; }
  .codr-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
  .codr-tiles div { background: #F3F6FC; border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
  .codr-tiles .hot { background: #FFF7ED; }
  .codr-tiles span { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: #5E6B85; font-weight: 700; }
  .codr-tiles b { font-size: 16px; font-variant-numeric: tabular-nums; }
  .codr-tiles em { font-style: normal; font-size: 11.5px; color: #46546F; }
  .codr-states { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .codr-states button { border: 1px solid transparent; background: #EEF2FA; color: #46546F; border-radius: 999px; padding: 4px 11px; font-size: 12px; font-weight: 600; cursor: pointer; }
  .codr-states button.on { border-color: currentColor; box-shadow: 0 0 0 1px currentColor inset; }
  .codr-flags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .codr-flags span { background: #FEF3C7; color: #92400E; border-radius: 8px; padding: 4px 9px; font-size: 12px; }
  .codr-search { display: flex; align-items: center; gap: 8px; border: 1px solid #D8E1F1; border-radius: 10px; padding: 7px 10px; margin-bottom: 10px; color: #5E6B85; }
  .codr-search input { border: none; outline: none; flex: 1; font-size: 13px; }
  .codr-table { overflow-x: auto; }
  .codr table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 900px; }
  .codr th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: #5E6B85; padding: 6px 8px; border-bottom: 1px solid #D8E1F1; }
  .codr td { padding: 8px; border-bottom: 1px solid #EEF2FA; vertical-align: top; }
  .codr td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .codr .sub { font-size: 11.5px; color: #5E6B85; margin-top: 2px; }
  .codr .sub.warn { color: #B45309; }
  .codr .miss { color: #BE123C; }
  .codr .pill { display: inline-block; border-radius: 999px; padding: 2px 9px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .codr .act { border: 1px solid #D8E1F1; background: #fff; border-radius: 8px; padding: 4px 9px; font-size: 11.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  @media (max-width: 760px) { .codr-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`;
