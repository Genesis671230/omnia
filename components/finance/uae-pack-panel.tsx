"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MinusCircle, PackageCheck, ScanLine, Undo2, Wand2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PACK_BOX_EVENT, type PackBoxEvent } from "@/lib/hooks/use-barcode-scanner";
import { PackGrid, editorHref } from "./ksa-dispatch-panel";

/* Pack from Omniastores LLC — the UAE warehouse twin of the KSA panel.
 * The packer scans each box (the orders page scanner broadcasts it here) or
 * taps the steppers; the draft starts empty so the count is exactly what was
 * scanned. A Zoho dry run re-checks after every change; Confirm reserves from
 * Omniastores LLC and closes the sales order from that warehouse
 * (POST /api/orders/[uid]/uae-pack). */

const C = {
  card: "#FFFFFF", raise: "#FBF8F1", line: "#EBE5D6", line2: "#DED6C2",
  ink: "#1C1913", body: "#5C5647", dim: "#8C8574", faint: "#B0A896",
  mint: "#3E8F63", mintBg: "#E7F1EA", amber: "#B67C1E", amberBg: "#F7EDD7",
  coral: "#C15540", coralBg: "#F7E7E1", gild: "#9A7526",
};

type Pack = { sku: string; qty: number };
type Issue = { code: string; message: string; blocking: boolean };
type Preview = {
  orderNumber: string;
  lines: { sku: string; qty: number; title: string; uaeStock: number | null }[];
  packaging: { sku: string; label: string; primary: boolean; uaeStock: number | null }[];
  suggestion: Pack[];
  basis: { sku: string; basis: string }[];
  soStatus: string | null;
  soInvoice: string | null;
  ksaSent: boolean;
  record: { packaging: Pack[]; match_order_total?: boolean; zoho_outcome: string | null; zoho_invoice: string | null; zoho_error: string | null; zoho_issues: Issue[]; pack_date: string } | null;
  warnings: string[];
};
type Check = { state: string; issues: Issue[]; changes: string[]; expectedTotal?: number; orderTotalAed?: number | null; cod?: boolean; invoiceDate?: string };
type Step = { ok: boolean; skipped?: boolean; flagged?: boolean; message: string };
type Result = { reserve: Step; zoho: Step };
type Counts = Record<string, number>;

const toList = (c: Counts): Pack[] => Object.entries(c).filter(([, q]) => q > 0).map(([sku, qty]) => ({ sku, qty }));
const toCounts = (l: Pack[]) => Object.fromEntries(l.map((x) => [x.sku, x.qty]));
const clamp = (q: number) => Math.max(0, Math.min(50, q));
/** Drafts survive closing and re-opening the order (and a re-scan of it) until the page reloads. */
const drafts = new Map<string, Counts>();

export function UaePackPanel({ uid, scanTarget, onDone }: { uid: string; scanTarget: boolean; onDone?: () => void }) {
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pack, setPackState] = useState<Counts>(() => drafts.get(uid) ?? {});
  const [flash, setFlash] = useState<string | null>(null);
  const [log, setLog] = useState<{ sku: string; at: number }[]>([]);
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [match, setMatch] = useState(false);
  const flashT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPack = useCallback((f: (c: Counts) => Counts) => {
    setPackState((c) => { const n = f(c); drafts.set(uid, n); return n; });
    setArmed(false);
  }, [uid]);

  const load = useCallback(() => {
    fetch(`/api/orders/${uid}/uae-pack`).then((r) => r.json()).then((d) => {
      if (d.error) { setErr(d.error); return; }
      setP(d);
      // Re-opening a saved pack (e.g. flagged): start from what was saved.
      if (!drafts.has(uid) && d.record?.packaging?.length) { const c = toCounts(d.record.packaging); drafts.set(uid, c); setPackState(c); }
      if (d.record?.match_order_total) setMatch(true);
    }).catch((e) => setErr(e.message));
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  const closed = p ? p.soStatus === "invoiced" || p.soStatus === "closed" || check?.state === "closed" : false;
  const closedRef = useRef(closed);
  closedRef.current = closed;

  // Scanned boxes from the orders page scanner — only the panel that is the scan target takes them.
  useEffect(() => {
    if (!scanTarget) return;
    const on = (ev: Event) => {
      const d = (ev as PackBoxEvent).detail;
      if (d.handled) return;
      d.handled = true;
      if (closedRef.current) { d.message = "This sales order is already invoiced — boxes can't be added here"; return; }
      d.message = `+1 ${d.sku}`;
      setPack((c) => ({ ...c, [d.sku]: clamp((c[d.sku] ?? 0) + 1) }));
      setLog((l) => [{ sku: d.sku, at: Date.now() }, ...l].slice(0, 8));
      setFlash(d.sku);
      if (flashT.current) clearTimeout(flashT.current);
      flashT.current = setTimeout(() => setFlash(null), 700);
    };
    window.addEventListener(PACK_BOX_EVENT, on);
    return () => window.removeEventListener(PACK_BOX_EVENT, on);
  }, [scanTarget, setPack]);

  // Zoho dry run — shortly after each change.
  const key = JSON.stringify([toList(pack), match]);
  useEffect(() => {
    if (!p || p.soStatus === "invoiced" || p.soStatus === "closed") return;
    let live = true;
    // A newer scan cancels the check still in flight — only the latest count matters.
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await fetch(`/api/orders/${uid}/uae-pack`, { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ check: true, packaging: toList(pack), matchOrderTotal: match }) });
        const d = await res.json().catch(() => ({}));
        if (live) setCheck(d.check ?? { state: "error", issues: [{ code: "error", message: d.error || `check failed (${res.status})`, blocking: true }], changes: [] });
      } catch (e) {
        if (live && (e as Error).name !== "AbortError") setCheck({ state: "error", issues: [{ code: "error", message: (e as Error).message, blocking: true }], changes: [] });
      } finally { if (live) setChecking(false); }
    }, 300);
    return () => { live = false; clearTimeout(t); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, p, uid]);

  async function confirm() {
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${uid}/uae-pack`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true, packaging: toList(pack), matchOrderTotal: match }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) throw new Error(d.error || `send failed (${res.status})`);
      setResult(d);
      if (d.zoho.ok) { toast.success(`${p?.orderNumber}: ${d.zoho.message}`); drafts.delete(uid); }
      else toast.error(`${p?.orderNumber}: ${d.zoho.message}`);
      load();
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const head: React.CSSProperties = { fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: C.faint, fontWeight: 700, margin: "14px 0 8px" };
  if (err) return <div style={{ marginTop: 12, fontSize: 12, color: C.coral }}>Omniastores LLC pack: {err}</div>;
  if (!p) return <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: C.dim }}><Loader2 size={13} className="spin" /> Reading Omniastores LLC stock and the sales order…</div>;
  if (p.ksaSent) return <div style={{ marginTop: 12, fontSize: 12, color: C.dim }}>{p.orderNumber} was sent from KSA — its boxes are on the KSA send.</div>;

  const total = Object.values(pack).reduce((s, n) => s + n, 0);
  const blockers = check?.issues.filter((i) => i.blocking) ?? [];
  const notes = check?.issues.filter((i) => !i.blocking) ?? [];
  const shortItems = closed ? [] : p.lines.filter((l) => (l.uaeStock ?? 0) < l.qty);
  const basisOf = new Map(p.basis.map((b) => [b.sku, b.basis]));
  const canConfirm = !closed && !busy && !checking && check != null && blockers.length === 0;

  return (
    <div style={{ marginTop: 12 }}>
      {p.warnings.map((w) => <div key={w} style={{ fontSize: 11.5, color: C.amber, marginBottom: 6 }}>{w}</div>)}

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: scanTarget && !closed ? C.mintBg : C.card, border: `1px solid ${scanTarget && !closed ? C.mint : C.line2}`, fontSize: 12, color: C.body }}>
        <ScanLine size={14} color={scanTarget && !closed ? C.mint : C.faint} />
        {closed
          ? <span>Sales order already invoiced{p.soInvoice ? ` (${p.soInvoice})` : ""} — stock has left Omniastores LLC.</span>
          : scanTarget
            ? <span><b style={{ color: C.ink }}>Scanner on this order</b> — scan each box (set box, bag, bangle box…); every scan adds 1.</span>
            : <span>Open this order by scanning it to use the scanner here, or use the + / − buttons.</span>}
        {scanTarget && !closed && <span className="scan-pulse" style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: 4, background: C.mint }} />}
      </div>

      <div style={head}>Items · from Omniastores LLC</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {p.lines.map((l) => {
          const short = !closed && (l.uaeStock ?? 0) < l.qty;
          return (
            <div key={l.sku} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", background: C.card, border: `1px solid ${short ? C.coral : C.line2}`, borderRadius: 8 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{l.sku}</span>
                <span style={{ fontSize: 11.5, color: C.dim }}> × {l.qty} · {l.title}</span>
                {basisOf.get(l.sku) && <span style={{ display: "block", fontSize: 10.5, color: C.faint }}>usually packed: {basisOf.get(l.sku)}</span>}
              </span>
              <span style={{ fontSize: 11, color: short ? C.coral : C.dim, whiteSpace: "nowrap" }}>UAE {l.uaeStock ?? "—"}</span>
            </div>
          );
        })}
      </div>

      <PackGrid title={`Boxes · ${total} scanned / picked`} options={p.packaging} stockOf={(o) => o.uaeStock} where="UAE" flash={flash}
        values={pack} onQty={(sku, q) => !closed && setPack((c) => ({ ...c, [sku]: clamp(q) }))} head={head} />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8, fontSize: 11.5, color: C.dim }}>
        {p.suggestion.length > 0 && <span>Usual for these items: {p.suggestion.map((s) => `${s.sku}×${s.qty}`).join(", ")}</span>}
        {!closed && p.suggestion.length > 0 && (
          <button type="button" onClick={() => setPack(() => toCounts(p.suggestion))} style={chip}><Wand2 size={11} /> Use it</button>
        )}
        {!closed && total > 0 && <button type="button" onClick={() => { setPack(() => ({})); setLog([]); }} style={chip}><MinusCircle size={11} /> Clear boxes</button>}
      </div>
      {log.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8, fontSize: 11 }}>
          <span style={{ color: C.faint }}>Scanned:</span>
          {log.map((s, i) => <span key={s.at + s.sku} style={{ padding: "1px 7px", borderRadius: 999, background: i === 0 ? C.mintBg : C.raise, border: `1px solid ${C.line2}`, color: C.body }}>{s.sku}</span>)}
          <button type="button" title="Undo the last scan" onClick={() => {
            const last = log[0];
            setPack((c) => ({ ...c, [last.sku]: clamp((c[last.sku] ?? 0) - 1) }));
            setLog((l) => l.slice(1));
          }} style={chip}><Undo2 size={11} /> Undo last</button>
        </div>
      )}

      {/* Zoho dry run */}
      {(check || checking) && !closed && (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, fontSize: 11.5, display: "flex", flexDirection: "column", gap: 4, background: !check ? C.card : blockers.length ? C.coralBg : C.mintBg, border: `1px solid ${!check ? C.line : blockers.length ? C.coral : C.mint}` }}>
          {!check ? <span style={{ color: C.dim, display: "inline-flex", alignItems: "center", gap: 6 }}><Loader2 size={11} className="spin" /> Checking the Zoho sales order…</span> : (
            <>
              <span style={{ fontWeight: 700, color: blockers.length ? C.coral : C.mint, display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {checking ? <Loader2 size={11} className="spin" /> : blockers.length ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                {blockers.length ? `Can't close yet (${blockers.length})` : "Zoho sales order ready to close from Omniastores LLC"}
                {check.expectedTotal != null && <span style={{ fontWeight: 400, color: C.body }}>· SO AED {check.expectedTotal.toFixed(2)}{check.orderTotalAed != null ? ` · order AED ${check.orderTotalAed.toFixed(2)}` : ""}{check.cod ? " · COD at AED 0" : ""}{check.invoiceDate ? ` · invoice ${check.invoiceDate}` : ""}</span>}
              </span>
              {blockers.map((i) => <span key={i.message} style={{ color: C.coral }}>• {i.message}</span>)}
              {notes.map((i) => <span key={i.message} style={{ color: C.amber }}>• {i.message}</span>)}
              {check.changes.length > 0 && <span style={{ color: C.body }}>Will change: {check.changes.join(" · ")}</span>}
              {blockers.length > 0 && <span style={{ color: C.body }}>Fix it in the <a href={editorHref(new Date().toISOString().slice(0, 7), p.orderNumber)} target="_blank" rel="noreferrer" style={{ color: C.gild, fontWeight: 600 }}>sales-order editor</a>, then come back.</span>}
            </>
          )}
        </div>
      )}
      {!closed && (
        <label style={{ display: "inline-flex", gap: 5, alignItems: "center", marginTop: 8, fontSize: 11.5, color: C.body, cursor: "pointer" }} title="Scale the item prices so the sales order totals exactly what was paid (shipping untouched; gaps over 1% stay flagged)">
          <input type="checkbox" checked={match} onChange={(e) => { setMatch(e.target.checked); setArmed(false); }} /> Match SO to order total
        </label>
      )}
      {shortItems.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, fontSize: 11.5, color: C.coral }}>
          <AlertTriangle size={12} style={{ marginTop: 2, flexShrink: 0 }} />
          <span>Omniastores LLC shows too few {shortItems.map((l) => l.sku).join(", ")} — the reserve will be refused.</span>
        </div>
      )}

      {!closed && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
          <button onClick={confirm} disabled={!canConfirm}
            style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: !canConfirm ? C.faint : armed ? C.coral : C.gild, color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: busy ? "wait" : canConfirm ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", gap: 6 }}>
            {busy ? <Loader2 size={12} className="spin" /> : <PackageCheck size={13} />}
            {armed ? `Confirm: reserve + invoice ${p.orderNumber} from Omniastores LLC` : `Confirm & close sales order${total ? ` · ${total} box${total === 1 ? "" : "es"}` : " · no boxes"}`}
          </button>
          {armed && <button onClick={() => setArmed(false)} style={{ background: "none", border: "none", color: C.dim, fontSize: 12, cursor: "pointer" }}>Cancel</button>}
          {total === 0 && !armed && <span style={{ fontSize: 11.5, color: C.amber }}>No boxes yet — scan them first.</span>}
        </div>
      )}

      {(result || p.record) && <ResultCard result={result} rec={p.record} />}
    </div>
  );
}

function ResultCard({ result, rec }: { result: Result | null; rec: Preview["record"] }) {
  const steps: [string, Step][] = result ? [["Stock reserved", result.reserve], ["Zoho sales order", result.zoho]] : [];
  const recClosed = rec && (rec.zoho_outcome === "closed" || (rec.zoho_outcome === "skipped" && !rec.zoho_error));
  return (
    <div style={{ marginTop: 14, padding: 12, background: C.raise, border: `1px solid ${result ? (result.zoho.ok ? C.line : C.coral) : recClosed ? C.line : C.coral}`, borderRadius: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: C.faint, fontWeight: 700 }}>Packed from Omniastores LLC{rec ? ` · ${rec.pack_date}` : ""}</span>
      {steps.map(([label, s]) => (
        <div key={label} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12 }}>
          {s.skipped ? <MinusCircle size={13} color={C.dim} /> : s.ok ? <CheckCircle2 size={13} color={C.mint} /> : s.flagged ? <AlertTriangle size={13} color={C.amber} /> : <XCircle size={13} color={C.coral} />}
          <span style={{ fontWeight: 600, color: C.ink, minWidth: 120 }}>{label}</span>
          <span style={{ color: s.ok ? C.body : C.coral }}>{s.message}</span>
        </div>
      ))}
      {!result && rec && (
        <>
          <div style={{ fontSize: 12, color: C.body }}>Boxes: {rec.packaging.map((x) => `${x.sku}×${x.qty}`).join(", ") || "none"}</div>
          <div style={{ fontSize: 12, color: recClosed ? C.body : C.coral }}>Zoho: {recClosed ? (rec.zoho_invoice ? `closed, invoice ${rec.zoho_invoice}` : "already closed") : (rec.zoho_issues?.filter((i) => i.blocking).map((i) => i.message).join("; ") || rec.zoho_error || "not closed")}</div>
        </>
      )}
    </div>
  );
}

const chip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 999, border: `1px solid ${C.line2}`, background: C.card, fontSize: 11, color: C.body, cursor: "pointer" };
