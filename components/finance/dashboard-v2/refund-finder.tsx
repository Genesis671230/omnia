"use client";

/* "Find refunds & cancellations" — above the Sales & receipts table.
 *
 * Reads a month's dispatch sheet (Local + SMSA tabs), the Zoho credit notes
 * and the gateway refund lines, and lists every order they show as
 * cancelled / returned / refunded / exchanged that the app hasn't marked
 * (/api/dispatch/sheet-adjustments). Nothing is applied until the founder
 * ticks orders and confirms. Applying marks the order in the app only
 * ("mark only": no new Zoho document — most already have their credit note
 * in Zoho, so raising another would credit twice). An order closed as
 * Received keeps that and gets the refund on top. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import type { SheetAdjustment, SuggestedKind } from "@/lib/dispatch/sheet-adjustments";

const KIND_LABEL: Record<SuggestedKind, string> = { cancelled: "Cancelled", returned: "Returned", refunded: "Refunded", exchanged: "Exchanged" };
const KIND_ORDER: SuggestedKind[] = ["cancelled", "returned", "refunded", "exchanged"];
const aed = (n: number) => `AED ${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const prevMonths = (n: number) => {
  const [y, m] = today().split("-").map(Number);
  return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - i, 1)); return d.toISOString().slice(0, 7); });
};

type Row = SheetAdjustment & { refundInput: string };
type Outcome = { ok: boolean; message: string };

export function RefundFinderButton({ defaultMonth, onApplied, onOpenOrder }: {
  defaultMonth: string;
  onApplied: () => void;
  onOpenOrder: (uid: string, orderNumber: string, kind: SuggestedKind) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="rf-btn" onClick={() => setOpen(true)}>Find refunds &amp; cancellations</button>
      <style>{RF_CSS}</style>
      {open && typeof document !== "undefined" && createPortal(
        <RefundFinder defaultMonth={defaultMonth} onClose={() => setOpen(false)} onApplied={onApplied}
          onOpenOrder={(uid, n, k) => { setOpen(false); onOpenOrder(uid, n, k); }} />,
        document.body,
      )}
    </>
  );
}

function RefundFinder({ defaultMonth, onClose, onApplied, onOpenOrder }: {
  defaultMonth: string; onClose: () => void; onApplied: () => void;
  onOpenOrder: (uid: string, orderNumber: string, kind: SuggestedKind) => void;
}) {
  const [month, setMonth] = useState(defaultMonth);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Map<string, Outcome>>(new Map());

  const load = useCallback(async (fresh = false) => {
    setRows(null); setError(""); setDone(new Map()); setConfirming(false);
    try {
      const r = await fetch(`/api/dispatch/sheet-adjustments?month=${month}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      const list = (j.suggestions as SheetAdjustment[]).map((s) => ({ ...s, refundInput: s.refundedAed ? String(s.refundedAed) : "" }));
      setRows(list);
      setSources([...(j.sheetSources ?? []), ...(j.sheetErrors ?? []).map((e: string) => `⚠ ${e}`)]);
      setPicked(new Set(list.filter((s) => !s.needsAmount).map((s) => s.uid)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !running) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, running]);

  const refundOf = (r: Row) => Math.min(Number(r.refundInput) || 0, r.grossAed);
  const needsInput = (r: Row) => (r.kind === "returned" || r.kind === "refunded") && !(refundOf(r) > 0);
  const chosen = (rows ?? []).filter((r) => picked.has(r.uid) && !done.get(r.uid)?.ok);
  const blocked = chosen.filter(needsInput);
  const totals = useMemo(() => {
    const t: Record<SuggestedKind, { n: number; aed: number }> = { cancelled: { n: 0, aed: 0 }, returned: { n: 0, aed: 0 }, refunded: { n: 0, aed: 0 }, exchanged: { n: 0, aed: 0 } };
    for (const r of chosen) { t[r.kind].n += 1; t[r.kind].aed += r.kind === "cancelled" ? r.grossAed : r.kind === "exchanged" ? 0 : refundOf(r); }
    return t;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, picked, done]);

  const setRefund = (uid: string, v: string) => setRows((rs) => rs && rs.map((r) => (r.uid === uid ? { ...r, refundInput: v } : r)));
  const toggle = (uid: string) => setPicked((p) => { const n = new Set(p); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const toggleKind = (k: SuggestedKind, on: boolean) => setPicked((p) => { const n = new Set(p); for (const r of rows ?? []) if (r.kind === k) { if (on) n.add(r.uid); else n.delete(r.uid); } return n; });

  async function apply() {
    setRunning(true);
    const out = new Map(done);
    for (const r of chosen) {
      if (needsInput(r)) continue;
      const refund = refundOf(r);
      const deduct = r.kind === "returned" || r.kind === "refunded" ? Math.max(Math.round((r.grossAed - refund) * 100) / 100, 0) : 0;
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(r.uid)}/adjust`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: r.kind, markOnly: true, dryRun: false, date: r.eventDate || today(),
            deductAed: deduct >= r.grossAed * 0.03 ? deduct : 0,
            note: `From ${monthLabel(month)} check — ${r.evidence.join(" · ")}`.slice(0, 900),
          }),
        });
        const j = await res.json();
        out.set(r.uid, { ok: res.ok && j.ok !== false, message: j.message || j.error || `HTTP ${res.status}` });
      } catch (e) {
        out.set(r.uid, { ok: false, message: (e as Error).message });
      }
      setDone(new Map(out));
    }
    setRunning(false);
    setConfirming(false);
    onApplied();
  }

  const okCount = [...done.values()].filter((d) => d.ok).length;
  const failCount = [...done.values()].filter((d) => !d.ok).length;

  return (
    <div className="rf-backdrop" onClick={() => !running && onClose()}>
      <div className="rf-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Refunds and cancellations to mark">
        <header className="rf-head">
          <div>
            <h3>Refunds, returns, cancellations &amp; exchanges not marked yet</h3>
            <p>From the dispatch sheet (Local + SMSA), Zoho credit notes and gateway refunds. Amount: gateway cash first, then the credit note, then the sheet.</p>
          </div>
          <button className="rf-x" onClick={onClose} disabled={running} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="rf-bar">
          <div className="rf-months">
            {prevMonths(4).map((m) => (
              <button key={m} className={`rf-chip ${m === month ? "on" : ""}`} disabled={running} onClick={() => setMonth(m)}>{monthLabel(m)}</button>
            ))}
          </div>
          <button className="rf-chip" onClick={() => load(true)} disabled={running || !rows}>Re-read sheet</button>
        </div>
        {sources.length > 0 && <p className="rf-src">Read: {sources.join(" · ")}</p>}
        {error && <p className="rf-err">Couldn&apos;t read: {error}</p>}

        <div className="rf-body">
          {!rows && !error && <p className="rf-quiet"><Loader2 size={14} className="rf-spin" /> Reading the {monthLabel(month)} sheet, Zoho credit notes and gateway refunds…</p>}
          {rows && rows.length === 0 && <p className="rf-quiet">Nothing to mark for {monthLabel(month)} — every refund, cancellation and exchange is already on its order.</p>}
          {rows && KIND_ORDER.map((k) => {
            const list = rows.filter((r) => r.kind === k);
            if (!list.length) return null;
            const allOn = list.every((r) => picked.has(r.uid));
            return (
              <section key={k} className="rf-group">
                <label className="rf-group-head">
                  <input type="checkbox" checked={allOn} disabled={running} onChange={(e) => toggleKind(k, e.target.checked)} />
                  {KIND_LABEL[k]} <span>{list.length} orders</span>
                </label>
                <table className="rf-table">
                  <tbody>
                    {list.map((r) => {
                      const d = done.get(r.uid);
                      return (
                        <tr key={r.uid} className={d ? (d.ok ? "ok" : "bad") : ""}>
                          <td className="rf-check"><input type="checkbox" checked={picked.has(r.uid)} disabled={running || d?.ok} onChange={() => toggle(r.uid)} /></td>
                          <td className="rf-order">
                            <b>#{r.orderNumber}</b>
                            <span>{r.store} · {r.gateway} · {r.orderDay}</span>
                            {r.wasReceived && <em>Marked received — refund goes on top</em>}
                          </td>
                          <td className="rf-amt">
                            <span>Sale {aed(r.grossAed)}</span>
                            {(k === "returned" || k === "refunded") && (
                              <label className={needsInput(r) ? "need" : ""}>
                                Refunded AED <input value={r.refundInput} inputMode="decimal" disabled={running || d?.ok} onChange={(e) => setRefund(r.uid, e.target.value)} placeholder="amount" />
                                {r.amountSource && <small>from {r.amountSource}</small>}
                              </label>
                            )}
                          </td>
                          <td className="rf-ev">{r.evidence.map((e) => <div key={e}>{e}</div>)}</td>
                          <td className="rf-act">
                            {d ? <span className={d.ok ? "rf-ok" : "rf-bad"} title={d.message}>{d.ok ? "Marked" : d.message}</span>
                              : <button className="rf-link" disabled={running} onClick={() => onOpenOrder(r.uid, r.orderNumber, r.kind)}>Open</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>

        <footer className="rf-foot">
          {done.size > 0 && !running && <span className="rf-sum">{okCount} marked{failCount ? ` · ${failCount} failed (see the rows)` : ""}</span>}
          {!confirming ? (
            <>
              <span className="rf-sum">
                {chosen.length} selected{blocked.length ? ` · ${blocked.length} need a refund amount` : ""}
              </span>
              <button className="rf-primary" disabled={!chosen.length || running || chosen.length === blocked.length} onClick={() => setConfirming(true)}>
                Review &amp; apply {chosen.length - blocked.length}
              </button>
            </>
          ) : (
            <div className="rf-confirm">
              <p>
                Mark these on their orders?{" "}
                {KIND_ORDER.filter((k) => totals[k].n).map((k) => `${totals[k].n} ${KIND_LABEL[k].toLowerCase()}${k === "exchanged" ? "" : ` (${aed(totals[k].aed)})`}`).join(" · ")}.
                {" "}The app only — <b>no new Zoho documents</b> (their credit notes are already in Zoho). Undo any order from its dialog.
              </p>
              <button className="rf-chip" disabled={running} onClick={() => setConfirming(false)}>Back</button>
              <button className="rf-primary" disabled={running} onClick={apply}>{running ? <><Loader2 size={14} className="rf-spin" /> Marking {done.size}/{chosen.length}…</> : "Yes, mark them"}</button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

const RF_CSS = `
  .rf-btn { height: 34px; border: 1px solid #0F1B3D; background: #0F1B3D; color: #fff; border-radius: 999px; padding: 0 14px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .rf-btn:hover { background: #1E2B55; }
  .rf-backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(15,27,61,.45); display: flex; align-items: center; justify-content: center; padding: 20px; font-family: var(--os-font); }
  .rf-modal { background: #fff; color: #0F1B3D; border-radius: 22px; width: min(1180px, 100%); max-height: calc(100vh - 40px); display: flex; flex-direction: column; box-shadow: 0 30px 80px -20px rgba(15,27,61,.5); }
  .rf-head { display: flex; justify-content: space-between; gap: 16px; padding: 20px 22px 8px; }
  .rf-head h3 { margin: 0; font-size: 17px; font-weight: 700; }
  .rf-head p { margin: 4px 0 0; font-size: 12.5px; color: #5E6B85; }
  .rf-x { border: 1px solid #D8E1F1; background: #fff; border-radius: 10px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
  .rf-bar { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 22px; }
  .rf-months { display: flex; gap: 6px; flex-wrap: wrap; }
  .rf-chip { height: 32px; border: 1px solid #D8E1F1; background: #fff; border-radius: 999px; padding: 0 12px; font: inherit; font-size: 12.5px; font-weight: 600; color: #46546F; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .rf-chip.on { background: #0F1B3D; border-color: #0F1B3D; color: #fff; }
  .rf-src { margin: 0 22px; font-size: 11.5px; color: #5E6B85; }
  .rf-err { margin: 8px 22px 0; color: #BE123C; font-size: 13px; }
  .rf-body { overflow: auto; padding: 8px 22px 12px; flex: 1; }
  .rf-quiet { color: #5E6B85; font-size: 13px; display: flex; gap: 8px; align-items: center; padding: 30px 0; justify-content: center; }
  .rf-spin { animation: rfspin 1s linear infinite; }
  @keyframes rfspin { to { transform: rotate(360deg); } }
  .rf-group { margin-top: 14px; }
  .rf-group-head { display: flex; gap: 8px; align-items: center; font-size: 13px; font-weight: 700; padding: 6px 0; position: sticky; top: -8px; background: #fff; z-index: 1; }
  .rf-group-head span { font-weight: 500; color: #5E6B85; }
  .rf-table { width: 100%; border-collapse: collapse; font-size: 12.5px; border: 1px solid #E6ECF7; border-radius: 12px; overflow: hidden; }
  .rf-table td { padding: 9px 10px; border-top: 1px solid #E6ECF7; vertical-align: top; }
  .rf-table tr.ok td { background: #ECFDF5; } .rf-table tr.bad td { background: #FFF1F2; }
  .rf-check { width: 30px; }
  .rf-order { min-width: 150px; } .rf-order b { font-family: ui-monospace, monospace; display: block; }
  .rf-order span { color: #5E6B85; font-size: 11.5px; } .rf-order em { display: block; font-style: normal; font-size: 11px; color: #B45309; margin-top: 3px; }
  .rf-amt { min-width: 190px; } .rf-amt > span { display: block; color: #46546F; }
  .rf-amt label { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 5px; font-size: 11.5px; color: #5E6B85; }
  .rf-amt input { width: 90px; height: 28px; border: 1px solid #D8E1F1; border-radius: 8px; padding: 0 8px; font: inherit; font-size: 12.5px; color: #0F1B3D; }
  .rf-amt label.need input { border-color: #F59E0B; background: #FFFBEB; }
  .rf-amt small { font-size: 10.5px; color: #8A94AD; width: 100%; }
  .rf-ev { color: #46546F; font-size: 11.5px; line-height: 1.45; } .rf-ev div + div { margin-top: 2px; }
  .rf-act { width: 90px; text-align: right; }
  .rf-link { border: 1px solid #D8E1F1; background: #fff; border-radius: 8px; height: 28px; padding: 0 10px; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; color: #1D4ED8; }
  .rf-ok { color: #047857; font-weight: 700; } .rf-bad { color: #BE123C; font-size: 11px; display: block; max-width: 160px; text-align: left; }
  .rf-foot { display: flex; justify-content: flex-end; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 22px; border-top: 1px solid #E6ECF7; }
  .rf-sum { font-size: 12.5px; color: #5E6B85; margin-right: auto; }
  .rf-primary { height: 38px; border: 0; background: #047857; color: #fff; border-radius: 999px; padding: 0 18px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .rf-primary:disabled { opacity: .5; cursor: not-allowed; }
  .rf-confirm { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; width: 100%; }
  .rf-confirm p { margin: 0; font-size: 13px; flex: 1; min-width: 300px; line-height: 1.5; }
`;
