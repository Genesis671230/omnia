"use client";
import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, XCircle, MinusCircle, Minus, Plus, Send, AlertTriangle, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { PACK_BOX_EVENT, type PackBoxEvent } from "@/lib/hooks/use-barcode-scanner";

// Same palette as fulfillment-spine.tsx (self-contained hex — see the modal
// portal note: tokens there live in .wrap, not :root).
const C = {
  card: "#FFFFFF", raise: "#FBF8F1", line: "#EBE5D6", line2: "#DED6C2",
  ink: "#1C1913", body: "#5C5647", dim: "#8C8574", faint: "#B0A896",
  mint: "#3E8F63", mintBg: "#E7F1EA", amber: "#B67C1E", amberBg: "#F7EDD7",
  coral: "#C15540", coralBg: "#F7E7E1", gild: "#9A7526",
};

type Preview = {
  orderNumber: string; shipDate: string; sheetTab: string; inSheet: boolean;
  lines: { sku: string; qty: number; title: string; ksaStock: number | null; uaeStock: number | null; suggested: boolean }[];
  packaging: { sku: string; label: string; primary: boolean; ksaStock: number | null; uaeStock: number | null }[];
  suggestion: { sku: string; qty: number }[];
  perLine: { sku: string; pack: { sku: string; qty: number }[]; basis: string }[];
  basis: { sku: string; basis: string }[];
  warnings: string[];
  soStatus: string | null;
};
type Step = { ok: boolean; skipped?: boolean; flagged?: boolean; message: string };
type Issue = { code: string; message: string; blocking: boolean };
type Fx = { currency: string; paid: number; rate: number; aed: number; source: "fixed" | "override" };
type ZohoCheck = { state: string; issues: Issue[]; changes: string[]; message?: string; soTotal?: number; expectedTotal?: number; orderTotalAed?: number | null; cod?: boolean; fx?: Fx | null; invoiceDate?: string };
export type KsaSelection = { ksaSkus: string[]; packaging: { sku: string; qty: number }[]; uaePackaging?: { sku: string; qty: number }[]; rateOverride?: number | null; matchOrderTotal?: boolean };
type Counts = Record<string, number>;
const toCounts = (l: { sku: string; qty: number }[]) => Object.fromEntries(l.map((x) => [x.sku, x.qty]));
const toList = (c: Counts) => Object.entries(c).filter(([, q]) => q > 0).map(([sku, qty]) => ({ sku, qty }));
/** Suggested boxes for a set of product lines (sum of each line's suggestion). */
function boxesFor(perLine: Preview["perLine"], skus: Set<string>): Counts {
  const out: Counts = {};
  for (const l of perLine) if (skus.has(l.sku)) for (const b of l.pack) out[b.sku] = (out[b.sku] ?? 0) + b.qty;
  return out;
}
export type KsaSendResult = { reserve: Step; sheet: Step; zoho: Step };

/** `initial` = a saved send being edited: its items and packaging replace the suggestion. */
export function KsaDispatchPanel({ uid, onSent, initial, onLoaded }: { uid: string; onSent: (r: KsaSendResult) => void; initial?: KsaSelection; onLoaded?: () => void }) {
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ksa, setKsa] = useState<Set<string>>(new Set());
  const [pack, setPack] = useState<Counts>({});        // boxes from KSA → KSA sheet
  const [uaePack, setUaePack] = useState<Counts>({});  // boxes from UAE (split) → Zoho only
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<ZohoCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [rate, setRate] = useState(initial?.rateOverride ? String(initial.rateOverride) : "");
  const [match, setMatch] = useState(Boolean(initial?.matchOrderTotal));
  const amountOpts = () => ({ ...(Number(rate) > 0 ? { rateOverride: Number(rate) } : {}), matchOrderTotal: match });

  useEffect(() => {
    fetch(`/api/orders/${uid}/ksa-dispatch`).then((r) => r.json()).then((d) => {
      if (d.error) { setErr(d.error); return; }
      setP(d);
      const k = new Set<string>(initial?.ksaSkus ?? d.lines.filter((l: Preview["lines"][number]) => l.suggested).map((l: { sku: string }) => l.sku));
      const rest = new Set<string>(d.lines.map((l: { sku: string }) => l.sku).filter((sku: string) => !k.has(sku)));
      setKsa(k);
      setPack(initial ? toCounts(initial.packaging) : boxesFor(d.perLine, k));
      setUaePack(initial?.uaePackaging ? toCounts(initial.uaePackaging) : boxesFor(d.perLine, rest));
      onLoaded?.();
    }).catch((e) => setErr(e.message));
  }, [uid, initial]);

  // A scanned box (orders page scanner) adds one to the KSA boxes.
  useEffect(() => {
    const on = (ev: Event) => {
      const d = (ev as PackBoxEvent).detail;
      if (d.handled) return;
      d.handled = true;
      d.message = `+1 ${d.sku} · KSA boxes`;
      setPack((s) => ({ ...s, [d.sku]: Math.min(50, (s[d.sku] ?? 0) + 1) }));
    };
    window.addEventListener(PACK_BOX_EVENT, on);
    return () => window.removeEventListener(PACK_BOX_EVENT, on);
  }, []);

  // Zoho dry run for the current selection — re-run shortly after each change.
  const selKey = JSON.stringify([[...ksa].sort(), toList(pack), toList(uaePack), rate, match]);
  useEffect(() => {
    if (!p || ksa.size === 0) { setCheck(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await fetch(`/api/orders/${uid}/ksa-dispatch`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ check: true, ksaSkus: [...ksa], packaging: toList(pack), uaePackaging: toList(uaePack), ...amountOpts() }),
        });
        const d = await res.json().catch(() => ({}));
        if (live) setCheck(d.check ?? { state: "error", issues: [{ code: "error", message: d.error || `check failed (${res.status})`, blocking: true }], changes: [] });
      } finally { if (live) setChecking(false); }
    }, 700);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, p, uid]);

  const rows = useMemo(() => {
    if (!p) return [];
    const products = p.lines.filter((l) => ksa.has(l.sku)).map((l) => ({ sku: l.sku, qty: l.qty, kind: "item" }));
    const boxes = p.packaging.filter((o) => (pack[o.sku] ?? 0) > 0).map((o) => ({ sku: o.sku, qty: pack[o.sku], kind: o.label }));
    return [...products, ...boxes];
  }, [p, ksa, pack]);

  if (err) return <div style={{ marginTop: 12, fontSize: 12, color: C.coral }}>KSA dispatch: {err}</div>;
  if (!p) return (
    <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: C.dim }}>
      <Loader2 size={13} className="spin" /> Reading KSA stock and packaging history…
    </div>
  );

  const split = ksa.size > 0 && ksa.size < p.lines.length;
  const flagged = Boolean(check?.issues.some((i) => i.blocking));
  // Each item is short against the warehouse it ships from — unless the order is
  // already invoiced in Zoho: then its stock has left already, that's not a shortage.
  const invoiced = p.soStatus === "invoiced" || check?.state === "closed";
  const shortKsa = invoiced ? [] : p.lines.filter((l) => ksa.has(l.sku) ? (l.ksaStock ?? 0) < l.qty : (l.uaeStock ?? 0) < l.qty);
  // Only packaging actually picked can be short (BAN101 at −16 with qty 0 is not a problem for this order).
  const shortPack = [
    ...p.packaging.filter((o) => (pack[o.sku] ?? 0) > 0 && (pack[o.sku] ?? 0) > (o.ksaStock ?? 0)).map((o) => `${o.sku} (KSA)`),
    ...(split ? p.packaging.filter((o) => (uaePack[o.sku] ?? 0) > 0 && (uaePack[o.sku] ?? 0) > (o.uaeStock ?? 0)).map((o) => `${o.sku} (UAE)`) : []),
  ];
  const basisOf = new Map(p.basis.map((b) => [b.sku, b.basis]));
  const clamp = (q: number) => Math.max(0, Math.min(50, q));
  // Moving an item between KSA and UAE re-suggests both halves' boxes.
  const moveLine = (sku: string, toKsa: boolean) => {
    const k = new Set(ksa);
    if (toKsa) k.add(sku); else k.delete(sku);
    setKsa(k);
    setPack(boxesFor(p.perLine, k));
    setUaePack(boxesFor(p.perLine, new Set(p.lines.map((l) => l.sku).filter((x) => !k.has(x)))));
  };

  async function sendNow() {
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${uid}/ksa-dispatch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ksaSkus: [...ksa], packaging: toList(pack), uaePackaging: split ? toList(uaePack) : [], ...amountOpts() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) throw new Error(d.error || `send failed (${res.status})`);
      onSent(d);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const head: React.CSSProperties = { fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: C.faint, fontWeight: 700, margin: "14px 0 8px" };

  return (
    <div style={{ marginTop: 12 }}>
      {p.warnings.map((w) => <div key={w} style={{ fontSize: 11.5, color: C.amber, marginBottom: 6 }}>{w}</div>)}
      {invoiced && <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 6 }}>{p.orderNumber} is already invoiced in Zoho — its items have left stock, so the counts below no longer include them.</div>}

      <div style={head}>Items · ship each from</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {p.lines.map((l) => {
          const fromKsa = ksa.has(l.sku);
          const shortHere = fromKsa ? (l.ksaStock ?? 0) < l.qty : (l.uaeStock ?? 0) < l.qty;
          const seg = (on: boolean, label: string, stock: number | null, toKsa: boolean) => (
            <button type="button" onClick={() => !on && moveLine(l.sku, toKsa)} style={{
              padding: "4px 9px", fontSize: 11, border: "none", cursor: on ? "default" : "pointer", whiteSpace: "nowrap",
              background: on ? (shortHere ? C.coral : C.mint) : C.card, color: on ? "#fff" : (stock ?? 0) >= l.qty ? C.body : C.faint,
            }}>{label} {stock ?? "—"}</button>
          );
          return (
            <div key={l.sku} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", background: C.card, border: `1px solid ${shortHere ? C.coral : C.line2}`, borderRadius: 8 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{l.sku}</span>
                <span style={{ fontSize: 11.5, color: C.dim }}> × {l.qty} · {l.title}</span>
                {basisOf.get(l.sku) && <span style={{ display: "block", fontSize: 10.5, color: C.faint }}>boxes: {basisOf.get(l.sku)}</span>}
              </span>
              <span style={{ display: "inline-flex", border: `1px solid ${C.line2}`, borderRadius: 6, overflow: "hidden" }}>
                {seg(fromKsa, "KSA", l.ksaStock, true)}
                {seg(!fromKsa, "UAE", l.uaeStock, false)}
              </span>
            </div>
          );
        })}
      </div>
      {split && <div style={{ fontSize: 11.5, color: C.amber, marginTop: 6 }}>Split order — only the KSA items and their boxes go to the KSA sheet. The UAE items ship from Omniastores LLC (the team logs their boxes in the UAE packing sheet); the Zoho sales order closes with each half from its own warehouse.</div>}

      <PackGrid title="Boxes from KSA — go to the KSA sheet" options={p.packaging} stockOf={(o) => o.ksaStock} where="KSA"
        values={pack} onQty={(sku, q) => setPack((s) => ({ ...s, [sku]: clamp(q) }))} head={head} />
      {split && (
        <PackGrid title="Boxes from UAE — Zoho only" options={p.packaging} stockOf={(o) => o.uaeStock} where="UAE"
          values={uaePack} onQty={(sku, q) => setUaePack((s) => ({ ...s, [sku]: clamp(q) }))} head={head} />
      )}

      <div style={head}>{p.sheetTab} · {p.shipDate} · {rows.length} row{rows.length === 1 ? "" : "s"}</div>
      {p.inSheet && <div style={{ fontSize: 11.5, color: C.amber, marginBottom: 6 }}>{p.orderNumber} is already in this tab — the sheet step will be skipped.</div>}
      <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 8, background: C.card }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ color: C.dim, textAlign: "left" }}>
              {["ReferenceNumber", "ShipDate", "SKU", "Quantity", ""].map((h) => <th key={h} style={{ padding: "6px 10px", borderBottom: `1px solid ${C.line}`, fontWeight: 600 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku}>
                <td style={cell}>{p.orderNumber}</td>
                <td style={cell}>{p.shipDate}</td>
                <td style={{ ...cell, fontWeight: 600, color: C.ink }}>{r.sku}</td>
                <td style={cell}>{r.qty}</td>
                <td style={{ ...cell, color: C.faint }}>{r.kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ZohoCheckBox check={check} checking={checking} orderNumber={p.orderNumber} />
      {check?.fx?.currency === "AED" && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: C.body }}>Paid <b style={{ color: C.ink }}>AED {check.fx.paid.toFixed(2)}</b></div>
      )}
      {(
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 8, fontSize: 11.5, color: C.body }}>
          {check?.fx && check.fx.currency !== "AED" && (
            <span>
              Paid {check.fx.currency} {check.fx.paid.toFixed(2)} ×{" "}
              <input value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={String(check.fx.source === "fixed" ? check.fx.rate : "")}
                title="Rate for this order — blank uses the fixed rate from Settings"
                style={{ width: 58, padding: "2px 4px", border: `1px solid ${rate ? C.gild : C.line2}`, borderRadius: 5, fontSize: 11.5, textAlign: "right" }} />
              {" "}= <b style={{ color: C.ink }}>AED {check.fx.aed.toFixed(2)}</b>
            </span>
          )}
          <label style={{ display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }} title="Scale the item prices so the sales order totals exactly paid × rate (shipping untouched; gaps over 1% stay flagged)">
            <input type="checkbox" checked={match} onChange={(e) => setMatch(e.target.checked)} /> Match SO to order total
          </label>
        </div>
      )}

      {(shortKsa.length > 0 || shortPack.length > 0) && (
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 8, fontSize: 11.5, color: shortKsa.length ? C.coral : C.amber }}>
          <AlertTriangle size={12} style={{ marginTop: 2, flexShrink: 0 }} />
          <span>
            {shortKsa.length > 0 && <>Not enough stock for {shortKsa.map((l) => `${l.sku} (${ksa.has(l.sku) ? "KSA" : "UAE"})`).join(", ")} in the warehouse picked — the send will be refused. </>}
            {shortPack.length > 0 && <>Zoho shows too few {shortPack.join(", ")} — the sheet is still written, but the Zoho invoice will be blocked until that stock is corrected.</>}
          </span>
        </div>
      )}

      <button onClick={sendNow} disabled={busy || ksa.size === 0 || shortKsa.length > 0}
        style={{
          marginTop: 12, padding: "8px 16px", borderRadius: 8, border: "none",
          background: ksa.size === 0 || shortKsa.length > 0 ? C.faint : C.gild, color: "#fff", fontSize: 12.5, fontWeight: 600,
          cursor: busy ? "wait" : ksa.size === 0 || shortKsa.length > 0 ? "not-allowed" : "pointer",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
        {busy ? <Loader2 size={12} className="spin" /> : <Send size={12} />}
        {initial ? "Save changes" : split ? "Reserve (KSA + UAE) & send KSA half" : "Reserve & send from KSA"}{flagged ? " · Zoho held (flagged)" : " · close Zoho SO"}
      </button>
    </div>
  );
}

type PackOption = { sku: string; label: string; primary: boolean };
/** Box picker — one card per packaging SKU with its stock and a stepper. `flash` highlights the box just scanned. */
export function PackGrid<O extends PackOption>({ title, options, stockOf, where, values, onQty, head, flash }: {
  title: string; options: O[]; stockOf: (o: O) => number | null; where: string;
  values: Counts; onQty: (sku: string, q: number) => void; head: React.CSSProperties; flash?: string | null;
}) {
  return (
    <>
      <div style={head}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {options.map((o) => {
          const q = values[o.sku] ?? 0;
          const stock = stockOf(o);
          const low = q > 0 && q > (stock ?? 0);
          return (
            <div key={o.sku} style={{ padding: "8px 10px", background: flash === o.sku ? C.amberBg : q ? C.mintBg : C.card, border: `1px solid ${flash === o.sku ? C.gild : low ? C.coral : q ? C.mint : C.line2}`, borderRadius: 8, opacity: o.primary || q ? 1 : 0.8, transform: flash === o.sku ? "scale(1.04)" : "none", transition: "transform .15s, background .3s, border-color .3s" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>{o.sku}</div>
              <div style={{ fontSize: 10.5, color: C.dim }}>{o.label} · <span style={{ color: low ? C.coral : C.dim }}>{where} {stock ?? "—"}</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                <button type="button" onClick={() => onQty(o.sku, q - 1)} style={stepBtn}><Minus size={11} /></button>
                <span style={{ minWidth: 18, textAlign: "center", fontSize: 13, fontWeight: 600, color: C.ink }}>{q}</span>
                <button type="button" onClick={() => onQty(o.sku, q + 1)} style={stepBtn}><Plus size={11} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export const editorHref = (month: string, orderNumber: string) => `/sales-orders?month=${month}&order=${encodeURIComponent(orderNumber)}`;

function ZohoCheckBox({ check, checking, orderNumber }: { check: ZohoCheck | null; checking: boolean; orderNumber: string }) {
  const box: React.CSSProperties = { marginTop: 12, padding: "10px 12px", borderRadius: 8, fontSize: 11.5, display: "flex", flexDirection: "column", gap: 4 };
  if (!check) return checking ? <div style={{ ...box, background: C.card, border: `1px solid ${C.line}`, color: C.dim }}><span><Loader2 size={11} className="spin" /> Checking the Zoho sales order…</span></div> : null;
  if (check.state === "split") return <div style={{ ...box, background: C.amberBg, color: C.amber }}>{check.message}</div>;
  if (check.state === "closed") return <div style={{ ...box, background: C.card, border: `1px solid ${C.line}`, color: C.dim }}>Zoho sales order is already invoiced — the Zoho step will be skipped. Packaging changes here won&apos;t reach Zoho.</div>;
  const blockers = check.issues.filter((i) => i.blocking);
  const notes = check.issues.filter((i) => !i.blocking);
  const amount = check.expectedTotal != null ? `SO AED ${check.expectedTotal.toFixed(2)}${check.orderTotalAed != null ? ` · order AED ${check.orderTotalAed.toFixed(2)}` : ""}${check.cod ? " · COD at AED 0" : ""}` : "";
  return (
    <div style={{ ...box, background: blockers.length ? C.coralBg : C.mintBg, border: `1px solid ${blockers.length ? C.coral : C.mint}` }}>
      <span style={{ fontWeight: 700, color: blockers.length ? C.coral : C.mint, display: "inline-flex", gap: 6, alignItems: "center" }}>
        {checking ? <Loader2 size={11} className="spin" /> : blockers.length ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
        {blockers.length ? `Flagged — Zoho close will be held (${blockers.length})` : "Zoho sales order ready to close"}
        {amount && <span style={{ fontWeight: 400, color: C.body }}>· {amount}</span>}
      </span>
      {blockers.map((i) => <span key={i.message} style={{ color: C.coral }}>• {i.message}</span>)}
      {notes.map((i) => <span key={i.message} style={{ color: C.amber }}>• {i.message}</span>)}
      {blockers.length > 0 && (
        <span style={{ color: C.body }}>
          Sending still reserves and writes the sheet so KSA can ship. Fix the order in the{" "}
          <a href={editorHref(new Date().toISOString().slice(0, 7), orderNumber)} target="_blank" rel="noreferrer" style={{ color: C.gild, fontWeight: 600 }}>sales-order editor</a> (batches, amounts, lines), then retry.
        </span>
      )}
    </div>
  );
}

/** A saved send on the order page: what happened, and the way back in. */
export function KsaRecordCard({ rec, onEdit, onRetry, busy }: {
  rec: { order_number: string; ship_date: string; split: boolean; sheet_tab: string | null; sheet_start_row: number | null; sheet_rows: number | null; sheet_error: string | null; zoho_outcome: string | null; zoho_invoice: string | null; zoho_error: string | null; zoho_issues: Issue[]; packaging: { sku: string; qty: number }[]; uae_packaging?: { sku: string; qty: number }[]; ksa_skus?: string[] };
  onEdit: () => void; onRetry: () => void; busy: boolean;
}) {
  const closed = rec.zoho_outcome === "closed" || (rec.zoho_outcome === "skipped" && !rec.zoho_error);
  const flagged = !closed;
  const sheetOk = Boolean(rec.sheet_start_row) && !rec.sheet_error;
  const btn: React.CSSProperties = { padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.line2}`, background: C.card, fontSize: 12, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center", color: C.ink, textDecoration: "none" };
  return (
    <div style={{ padding: 12, background: flagged ? C.coralBg : C.raise, border: `1px solid ${flagged ? C.coral : C.line}`, borderRadius: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: flagged ? C.coral : C.faint, fontWeight: 700 }}>
        KSA dispatch · {rec.ship_date}{flagged ? " · flagged" : ""}{rec.split ? " · split" : ""}
      </span>
      <div style={{ fontSize: 12, color: C.body }}>
        {rec.split && rec.ksa_skus?.length ? <>From KSA: {rec.ksa_skus.join(", ")} · </> : null}
        Boxes{rec.split ? " (KSA)" : ""}: {rec.packaging.map((p) => `${p.sku}×${p.qty}`).join(", ") || "none"}
        {rec.split && <> · Boxes (UAE): {(rec.uae_packaging ?? []).map((p) => `${p.sku}×${p.qty}`).join(", ") || "from the packing sheet"}</>}
      </div>
      <div style={{ fontSize: 12, color: rec.sheet_error ? C.coral : C.body }}>
        Sheet: {rec.sheet_error ? rec.sheet_error : sheetOk ? `${rec.sheet_rows} rows in "${rec.sheet_tab}" from row ${rec.sheet_start_row}` : "not written by this system (already in the tab)"}
      </div>
      <div style={{ fontSize: 12, color: flagged ? C.coral : C.body }}>
        Zoho: {closed ? (rec.zoho_invoice ? `closed, invoice ${rec.zoho_invoice}` : "already closed") : (rec.zoho_issues?.filter((i) => i.blocking).map((i) => i.message).join("; ") || rec.zoho_error || "not closed")}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <button onClick={onEdit} style={btn}>Edit KSA send</button>
        <a href={editorHref(rec.ship_date.slice(0, 7), rec.order_number)} target="_blank" rel="noreferrer" style={btn}>Open sales-order editor</a>
        {(flagged || rec.sheet_error) && <button onClick={onRetry} disabled={busy} style={btn}>{busy ? <Loader2 size={12} className="spin" /> : <RotateCw size={12} />} Retry</button>}
      </div>
    </div>
  );
}

/** The three step outcomes after a send, with a retry when one failed. */
export function KsaSendSummary({ result, onRetry, busy }: { result: KsaSendResult; onRetry?: () => void; busy?: boolean }) {
  const steps: [string, Step][] = [["Stock reserved", result.reserve], ["KSA sheet", result.sheet], ["Zoho sales order", result.zoho]];
  const failed = steps.some(([, s]) => !s.ok);
  return (
    <div style={{ marginTop: 14, padding: 12, background: C.raise, border: `1px solid ${failed ? C.coral : C.line}`, borderRadius: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: C.faint, fontWeight: 700 }}>Sent from KSA</span>
      {steps.map(([label, s]) => (
        <div key={label} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12 }}>
          {s.skipped ? <MinusCircle size={13} color={C.dim} /> : s.ok ? <CheckCircle2 size={13} color={C.mint} /> : s.flagged ? <AlertTriangle size={13} color={C.amber} /> : <XCircle size={13} color={C.coral} />}
          <span style={{ fontWeight: 600, color: C.ink, minWidth: 120 }}>{label}</span>
          <span style={{ color: s.ok ? C.body : C.coral }}>{s.message}</span>
        </div>
      ))}
      {failed && onRetry && (
        <button onClick={onRetry} disabled={busy} style={{ alignSelf: "flex-start", marginTop: 4, padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.line2}`, background: C.card, fontSize: 12, cursor: busy ? "wait" : "pointer", display: "inline-flex", gap: 6, alignItems: "center" }}>
          {busy ? <Loader2 size={12} className="spin" /> : <RotateCw size={12} />} Retry failed steps
        </button>
      )}
    </div>
  );
}

const stepBtn: React.CSSProperties = { width: 22, height: 22, borderRadius: 6, border: `1px solid ${C.line2}`, background: C.card, display: "grid", placeItems: "center", cursor: "pointer", color: C.body };
const cell: React.CSSProperties = { padding: "5px 10px", borderBottom: `1px solid ${C.line}`, color: C.body };
