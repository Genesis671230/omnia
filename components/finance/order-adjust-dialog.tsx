"use client";

/* Cancel / return / refund / exchange an order — and raise its Zoho credit
   note (and an exchange's replacement invoice) on the spot.

   Flow: pick what happened → the order's invoice is found in whichever Zoho
   org holds it (COD in House of Omnia) → pick the lines coming back, any
   damage kept, the replacement items → Preview (nothing written) → Post.
   Posting is a separate click on a preview of exactly these inputs.

   Portaled to <body> with self-contained hex: an inline position:fixed inside
   the dashboard's stacking context is what broke the invoice/ship modals. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X, Loader2, Search, Plus, Trash2, Undo2, ExternalLink, AlertTriangle, CheckCircle2 } from "lucide-react";

type Kind = "cancelled" | "returned" | "refunded" | "exchanged" | "received";
const KINDS: { k: Kind; label: string; help: string }[] = [
  { k: "received", label: "Received", help: "Nothing went back — the money came in another way (paid with another order, by hand, a transfer). Records the payment in the account you pick and closes the invoice." },
  { k: "cancelled", label: "Cancelled", help: "Never delivered. Full credit note, applied to the invoice so both close." },
  { k: "returned", label: "Returned", help: "Items came back. Credit what came back, less any damage the customer pays." },
  { k: "refunded", label: "Refunded", help: "Money goes back (prepaid). The note stays open; the gateway refund in a payout closes it." },
  { k: "exchanged", label: "Exchanged", help: "Items swapped. Credit note for what came back, new invoice to the same customer, note applied to it." },
];

type Line = { line_item_id: string; item_id?: string; name: string; quantity: number; item_total: number; tax_percentage?: number };
type Invoice = { invoice_id: string; invoice_number: string; customer_name?: string; status: string; total: number; balance: number; is_inclusive_tax: boolean; line_items: Line[] };
type Candidate = { connectionId: string; org: string; orgId: string; invoiceId: string; number: string; customer: string; date: string; status: string; total: number; balance: number };
type Adjustment = {
  id: string; kind: Kind; status: string; credit_aed: number; damage_aed: number; zoho_creditnote_number: string; zoho_exchange_invoice_number: string;
  refund_due_aed: number; customer_owes_aed: number; mark_only: boolean; error: string | null; adjustment_date: string; created_by: string;
};
type Context = {
  order: { order_number: string; customer_name: string; gross_aed: number; gateway: string; store_id: string; financial_status: string };
  adjustments: Adjustment[]; candidates: Candidate[]; errors: string[]; chosen: Candidate | null; invoice: Invoice | null;
};
type Plan = {
  ok: boolean; error: string | null; creditAed: number; returnedGrossAed: number; deductAed: number; exchangeTotalAed: number;
  applyToExchangeAed: number; applyToInvoiceAed: number; refundDueAed: number; customerOwesAed: number; steps: string[];
};
type RunResult = { ok: boolean; dryRun: boolean; plan: Plan | null; message: string; documents: { creditNote: string | null; exchangeInvoice: string | null } };
type ExItem = { item_id?: string; name: string; qty: number; unitGross: number };

const C = {
  ink: "#0F1B3D", dim: "#5E6B85", line: "#D8E1F1", bg: "#F3F6FC", card: "#FFFFFF", blue: "#2563EB", blueBg: "#EAF1FE",
  red: "#BE123C", redBg: "#FFE4E6", green: "#047857", greenBg: "#D1FAE5", amber: "#B45309", amberBg: "#FEF3C7",
};
const aed = (n: number) => `AED ${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
const unitGross = (inv: Invoice, l: Line) => (l.quantity ? (l.item_total / l.quantity) * (inv.is_inclusive_tax ? 1 : 1 + (l.tax_percentage ?? 0) / 100) : 0);

export function OrderAdjustDialog({ uid, orderNumber, initialKind, onClose, onDone }: {
  uid: string; orderNumber: string; initialKind?: Kind; onClose: () => void; onDone?: () => void;
}) {
  const [ctx, setCtx] = useState<Context | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<Kind>(initialKind ?? "returned");
  const [pick, setPick] = useState<Candidate | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [deduct, setDeduct] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [markOnly, setMarkOnly] = useState(false);
  const [exItems, setExItems] = useState<ExItem[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ item_id: string; name: string; sku: string; rate: number; stock_on_hand: number | null }[]>([]);
  const [searching, setSearching] = useState(false);
  const [preview, setPreview] = useState<{ key: string; result: RunResult } | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "post" | "undo" | "invoice">(null);
  // "Received — close invoice"
  const [via, setVia] = useState("");
  const [recvAmt, setRecvAmt] = useState("");
  const [accounts, setAccounts] = useState<{ account_id: string; account_name: string; account_type?: string }[]>([]);
  const [accountId, setAccountId] = useState("");
  const [accLoading, setAccLoading] = useState(false);

  const load = useCallback(async (sel?: { zohoOrg: string; invoiceId: string }) => {
    setLoading(true); setLoadErr("");
    try {
      const qs = sel ? `?${new URLSearchParams(sel)}` : "";
      const res = await fetch(`/api/orders/${uid}/adjust${qs}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setCtx(j); setPick(j.chosen); setInvoice(j.invoice);
      setQty(Object.fromEntries((j.invoice?.line_items ?? []).map((l: Line) => [l.line_item_id, l.quantity])));
      if (!j.candidates.length) setMarkOnly(true);
      setVia((v) => v || j.order.gateway || "");
      setRecvAmt((a) => a || String(j.invoice?.balance ?? ""));
    } catch (e) {
      setLoadErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  const choose = async (c: Candidate) => {
    setBusy("invoice");
    await load({ zohoOrg: c.connectionId, invoiceId: c.invoiceId });
    setBusy(null);
  };

  // item search for exchanges, debounced
  useEffect(() => {
    if (kind !== "exchanged" || q.trim().length < 2 || !pick) { setHits([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/orders/${uid}/adjust/items?${new URLSearchParams({ zohoOrg: pick.connectionId, q })}`);
        const j = await res.json();
        setHits(j.items ?? []);
      } finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, kind, pick, uid]);

  // deposit accounts of the invoice's org, gateway clearing account suggested
  useEffect(() => {
    if (kind !== "received" || !pick) return;
    let off = false;
    setAccLoading(true);
    fetch(`/api/orders/${uid}/adjust/accounts?${new URLSearchParams({ zohoOrg: pick.connectionId, gateway: via })}`)
      .then((r) => r.json())
      .then((j) => { if (off || j.error) return; setAccounts(j.accounts ?? []); setAccountId((cur) => cur && (j.accounts ?? []).some((a: { account_id: string }) => a.account_id === cur) ? cur : j.suggestedId || ""); })
      .finally(() => { if (!off) setAccLoading(false); });
    return () => { off = true; };
  }, [kind, pick, via, uid]);

  // A "received" close still allows a later refund / return / cancellation;
  // any other posted adjustment has to be undone first.
  const postedAll = ctx?.adjustments.filter((a) => a.status === "posted") ?? [];
  const posted = postedAll.find((a) => a.kind !== "received") ?? postedAll[0] ?? null;
  const canStack = Boolean(posted && posted.kind === "received" && postedAll.length === 1);
  const resumable = ctx?.adjustments.find((a) => a.status !== "posted") ?? null;
  const taxPct = invoice?.line_items.find((l) => (l.tax_percentage ?? 0) > 0)?.tax_percentage ?? 0;

  const body = useMemo(() => {
    const allLines = invoice?.line_items ?? [];
    const picks = allLines.map((l) => ({ line_item_id: l.line_item_id, qty: Math.max(0, Math.min(qty[l.line_item_id] ?? 0, l.quantity)) }));
    const whole = picks.every((p, i) => p.qty === allLines[i].quantity);
    return {
      kind, zohoOrg: pick?.connectionId ?? null, invoiceId: pick?.invoiceId ?? null, date, note, markOnly,
      picks: kind === "cancelled" || whole ? [] : picks.filter((p) => p.qty > 0),
      deductAed: kind === "cancelled" ? 0 : Number(deduct) || 0,
      exchange: kind === "exchanged" ? exItems : [],
      ...(kind === "received" ? { receivedAed: Number(recvAmt) || 0, receivedVia: via, depositAccountId: accountId,
        depositAccountName: accounts.find((a) => a.account_id === accountId)?.account_name ?? "" } : {}),
    };
  }, [kind, pick, date, note, markOnly, qty, deduct, exItems, invoice, recvAmt, via, accountId, accounts]);
  const bodyKey = JSON.stringify(body);
  const fresh = preview?.key === bodyKey ? preview.result : null;

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? "preview" : "post");
    try {
      const res = await fetch(`/api/orders/${uid}/adjust`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, dryRun }) });
      const j = (await res.json()) as RunResult & { error?: string };
      if (j.error && !j.message) throw new Error(j.error);
      if (dryRun) { setPreview({ key: bodyKey, result: j }); if (!j.ok) toast.error(j.message); return; }
      if (!j.ok) { toast.error(j.message, { duration: 12000 }); await load(pick ? { zohoOrg: pick.connectionId, invoiceId: pick.invoiceId } : undefined); return; }
      toast.success(j.message, { duration: 10000 });
      onDone?.();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };

  const undo = async (a: Adjustment) => {
    setBusy("undo");
    try {
      const res = await fetch(`/api/orders/${uid}/adjust?id=${a.id}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) { toast.error(j.message || j.error, { duration: 10000 }); return; }
      toast.success(j.message);
      onDone?.();
      await load();
    } finally { setBusy(null); }
  };

  if (typeof document === "undefined") return null;
  const inp: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 10px", fontSize: 13, color: C.ink, background: C.card, outline: "none" };
  const btn = (tone: "primary" | "ghost" | "danger"): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
    border: `1px solid ${tone === "primary" ? C.blue : tone === "danger" ? C.red : C.line}`,
    background: tone === "primary" ? C.blue : tone === "danger" ? C.redBg : C.card, color: tone === "primary" ? "#fff" : tone === "danger" ? C.red : C.ink,
  });
  const section: React.CSSProperties = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, marginBottom: 12 };
  const h: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: C.dim, fontWeight: 700, margin: "0 0 10px" };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,27,61,.55)", zIndex: 120, display: "grid", placeItems: "center", padding: 16, fontFamily: "var(--os-font, system-ui)" }}>
      <div role="dialog" aria-modal="true" aria-label={`Adjust order ${orderNumber}`} onClick={(e) => e.stopPropagation()}
        style={{ background: C.bg, color: C.ink, width: "100%", maxWidth: 720, maxHeight: "92vh", overflowY: "auto", borderRadius: 18, padding: 20, boxShadow: "0 24px 70px rgba(0,0,0,.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: C.dim, fontWeight: 700 }}>Cancel · return · refund · exchange</div>
            <h2 style={{ margin: "4px 0 2px", fontSize: 20, fontWeight: 600 }}>Order #{orderNumber}</h2>
            {ctx && <div style={{ fontSize: 12.5, color: C.dim }} dir="auto">{ctx.order.customer_name} · {ctx.order.store_id} · {ctx.order.gateway} · {aed(Number(ctx.order.gross_aed))} · store says “{ctx.order.financial_status}”</div>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ ...btn("ghost"), padding: 8 }}><X size={16} /></button>
        </div>

        {loading && !ctx && <div style={{ ...section, display: "flex", gap: 8, alignItems: "center", color: C.dim }}><Loader2 size={14} className="spin" /> Looking for the order's invoice in every Zoho organisation…</div>}
        {loadErr && <div style={{ ...section, color: C.red, background: C.redBg }}>{loadErr}</div>}

        {ctx && posted && (
          <div style={{ ...section, background: C.greenBg, borderColor: "#A7F3D0" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, color: C.green }}><CheckCircle2 size={15} /> Marked {posted.kind} on {posted.adjustment_date} by {posted.created_by || "—"}</div>
            <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
              {posted.mark_only ? "No Zoho documents written by the app." : <>Credit note <b>{posted.zoho_creditnote_number}</b> for {aed(posted.credit_aed)}{posted.damage_aed ? ` (${aed(posted.damage_aed)} damage / kept)` : ""}{posted.zoho_exchange_invoice_number && <> · exchange invoice <b>{posted.zoho_exchange_invoice_number}</b></>}.</>}
              {posted.refund_due_aed > 0 && <> Refund due: <b>{aed(posted.refund_due_aed)}</b>.</>}
              {posted.customer_owes_aed > 0 && <> Customer owes: <b>{aed(posted.customer_owes_aed)}</b>.</>}
            </div>
            <button style={{ ...btn("ghost"), marginTop: 10 }} disabled={busy === "undo"} onClick={() => undo(posted)}>
              {busy === "undo" ? <Loader2 size={13} className="spin" /> : <Undo2 size={13} />} Undo
            </button>
            {!posted.mark_only && <span style={{ fontSize: 12, color: C.dim, marginLeft: 10 }}>Undo works once the documents are deleted in Zoho.</span>}
          </div>
        )}

        {ctx && (!posted || canStack) && (
          <>
            {resumable && (
              <div style={{ ...section, background: C.amberBg, borderColor: "#FCD34D", fontSize: 13 }}>
                <b style={{ color: C.amber }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> An earlier attempt stopped</b> ({resumable.kind}{resumable.zoho_creditnote_number ? `, credit note ${resumable.zoho_creditnote_number} created` : ""}): {resumable.error || "not finished"}.
                Preview and post again with the same choice to finish it — nothing is created twice.
              </div>
            )}

            <div style={section}>
              <p style={h}>What happened</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                {KINDS.map((x) => (
                  <button key={x.k} onClick={() => setKind(x.k)} style={{ ...btn(kind === x.k ? "primary" : "ghost"), justifyContent: "center" }}>{x.label}</button>
                ))}
              </div>
              <p style={{ fontSize: 12.5, color: C.dim, margin: "8px 0 0" }}>{KINDS.find((x) => x.k === kind)!.help}</p>
            </div>

            <div style={section}>
              <p style={h}>Zoho invoice</p>
              {ctx.candidates.length === 0 && (
                <div style={{ fontSize: 13, color: C.amber }}>No invoice for #{orderNumber} in any Zoho organisation{ctx.errors.length ? ` (${ctx.errors.join("; ")})` : ""}. You can still mark the order so the reports count it correctly.</div>
              )}
              {ctx.candidates.map((c) => (
                <label key={c.invoiceId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px", fontSize: 13, cursor: "pointer", borderBottom: `1px dashed ${C.line}` }}>
                  <input type="radio" checked={pick?.invoiceId === c.invoiceId} onChange={() => choose(c)} disabled={busy === "invoice"} />
                  <b>{c.number}</b>
                  <span style={{ color: C.dim }}>{c.org}</span>
                  <span style={{ color: C.dim }} dir="auto">{c.customer}</span>
                  <span style={{ marginLeft: "auto" }}>{aed(c.total)}</span>
                  <span style={{ fontSize: 11.5, padding: "2px 8px", borderRadius: 999, background: c.balance > 0 ? C.amberBg : C.greenBg, color: c.balance > 0 ? C.amber : C.green }}>
                    {c.status}{c.balance > 0 ? ` · ${aed(c.balance)} unpaid` : ""}
                  </span>
                </label>
              ))}
              {ctx.candidates.length > 1 && !pick && <div style={{ fontSize: 12.5, color: C.amber, marginTop: 6 }}>Several invoices — pick the one this concerns.</div>}
              {busy === "invoice" && <div style={{ fontSize: 12.5, color: C.dim, marginTop: 6 }}><Loader2 size={12} className="spin" /> Loading invoice…</div>}
            </div>

            {invoice && !markOnly && kind === "received" && (
              <div style={section}>
                <p style={h}>Money received · closes {invoice.invoice_number}</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
                  <label>Received via (gateway / method)
                    <select value={via} onChange={(e) => setVia(e.target.value)} style={{ ...inp, width: "100%", marginTop: 4 }}>
                      {[...new Set([ctx.order.gateway, "Stripe", "Tabby", "Tamara", "Telr", "Checkout", "Shopify Payments", "COD", "Bank transfer", "Cash"].filter(Boolean))].map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </label>
                  <label>Amount AED (open {aed(invoice.balance)})
                    <input type="number" min={0} step="0.01" value={recvAmt} onChange={(e) => setRecvAmt(e.target.value)} style={{ ...inp, width: "100%", marginTop: 4 }} />
                  </label>
                  <label style={{ gridColumn: "1 / -1" }}>Deposited to (Zoho account) {accLoading && <Loader2 size={11} className="spin" />}
                    <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ ...inp, width: "100%", marginTop: 4 }}>
                      <option value="">— pick the account —</option>
                      {accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.account_name}{a.account_type ? ` · ${a.account_type.replace(/_/g, " ")}` : ""}</option>)}
                    </select>
                  </label>
                </div>
                {invoice.balance <= 0.01 && <div style={{ fontSize: 12.5, color: C.amber, marginTop: 8 }}>{invoice.invoice_number} is already paid in Zoho — tick “Mark only” to mark the order received.</div>}
              </div>
            )}

            {invoice && !markOnly && kind !== "cancelled" && kind !== "received" && (
              <div style={section}>
                <p style={h}>Lines coming back · {invoice.invoice_number}</p>
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <tbody>
                    {invoice.line_items.map((l) => (
                      <tr key={l.line_item_id} style={{ borderBottom: `1px solid ${C.bg}` }}>
                        <td style={{ padding: "6px 4px" }}>{l.name}</td>
                        <td style={{ padding: "6px 4px", color: C.dim, whiteSpace: "nowrap" }}>{l.quantity} × {aed(unitGross(invoice, l))}</td>
                        <td style={{ padding: "6px 4px", width: 90 }}>
                          <input type="number" min={0} max={l.quantity} value={qty[l.line_item_id] ?? 0}
                            onChange={(e) => setQty({ ...qty, [l.line_item_id]: Math.max(0, Math.min(l.quantity, Number(e.target.value))) })} style={{ ...inp, width: 70 }} aria-label={`Quantity of ${l.name} coming back`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 13 }}>{kind === "refunded" ? "Not refunded (kept)" : "Damage — customer pays"} AED</label>
                  <input type="number" min={0} value={deduct} onChange={(e) => setDeduct(e.target.value)} placeholder="0.00" style={{ ...inp, width: 120 }} />
                  <span style={{ fontSize: 12, color: C.dim }}>Taken off the credit note; on an unpaid invoice it stays owed.</span>
                </div>
              </div>
            )}

            {kind === "exchanged" && invoice && !markOnly && (
              <div style={section}>
                <p style={h}>Replacement items (new invoice to the same customer)</p>
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, ...inp }}>
                    <Search size={13} color={C.dim} />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search items in ${pick?.org ?? "Zoho"} by name or SKU…`} style={{ border: "none", outline: "none", flex: 1, fontSize: 13 }} />
                    {searching && <Loader2 size={12} className="spin" />}
                  </div>
                  {hits.length > 0 && (
                    <div style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 5, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, marginTop: 4, maxHeight: 220, overflowY: "auto", boxShadow: "0 10px 30px rgba(0,0,0,.12)" }}>
                      {hits.map((it) => (
                        <button key={it.item_id} onClick={() => { setExItems([...exItems, { item_id: it.item_id, name: it.name, qty: 1, unitGross: Math.round(it.rate * (invoice.is_inclusive_tax ? 1 : 1 + taxPct / 100) * 100) / 100 }]); setQ(""); setHits([]); }}
                          style={{ display: "flex", width: "100%", gap: 8, padding: "8px 10px", border: "none", background: "none", cursor: "pointer", fontSize: 13, textAlign: "left" }}>
                          <span style={{ flex: 1 }}>{it.name} <span style={{ color: C.dim }}>{it.sku}</span></span>
                          <span style={{ color: C.dim }}>{it.stock_on_hand != null ? `${it.stock_on_hand} in stock · ` : ""}{aed(it.rate)}{invoice.is_inclusive_tax ? "" : " ex VAT"}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {exItems.map((e, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 13 }}>
                    <span style={{ flex: 1 }}>{e.name}</span>
                    <input type="number" min={1} value={e.qty} onChange={(ev) => setExItems(exItems.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(ev.target.value)) } : x)))} style={{ ...inp, width: 60 }} aria-label="Quantity" />
                    <span style={{ color: C.dim }}>×</span>
                    <input type="number" min={0} step="0.01" value={e.unitGross} onChange={(ev) => setExItems(exItems.map((x, j) => (j === i ? { ...x, unitGross: Number(ev.target.value) } : x)))} style={{ ...inp, width: 110 }} aria-label="Price incl. VAT" />
                    <span style={{ fontSize: 11.5, color: C.dim }}>incl. VAT</span>
                    <button onClick={() => setExItems(exItems.filter((_, j) => j !== i))} style={{ ...btn("ghost"), padding: 6 }} aria-label="Remove"><Trash2 size={13} /></button>
                  </div>
                ))}
                <button onClick={() => setExItems([...exItems, { name: "Exchange item", qty: 1, unitGross: 0 }])} style={{ ...btn("ghost"), marginTop: 8, fontSize: 12 }}><Plus size={12} /> Add a line without an item</button>
              </div>
            )}

            <div style={section}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ fontSize: 13 }}>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inp, marginLeft: 6 }} /></label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (reason, courier, condition…)" style={{ ...inp, flex: 1, minWidth: 200 }} />
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, marginTop: 10, color: C.dim, cursor: "pointer" }}>
                <input type="checkbox" checked={markOnly} onChange={(e) => setMarkOnly(e.target.checked)} style={{ marginTop: 2 }} />
                <span>Mark only — don't write to Zoho (the credit note is already there, or the order was never invoiced). Reports still count it.</span>
              </label>
            </div>

            {fresh && (
              <div style={{ ...section, background: fresh.ok ? C.blueBg : C.redBg, borderColor: fresh.ok ? "#BFD3F8" : "#FECDD3" }}>
                <p style={h}>Preview — nothing written yet</p>
                {!fresh.ok && <div style={{ color: C.red, fontSize: 13 }}>{fresh.message}</div>}
                {fresh.ok && !fresh.plan && <div style={{ fontSize: 13 }}>{fresh.message}</div>}
                {fresh.plan?.ok && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
                      {(kind === "received"
                        ? [["Payment applied", fresh.plan.applyToInvoiceAed], ["Left open on invoice", fresh.plan.customerOwesAed], ["Credit note", 0]]
                        : [["Credit note", fresh.plan.creditAed], ["Refund / store credit due", fresh.plan.refundDueAed], ["Customer still owes", fresh.plan.customerOwesAed]]).map(([l, v]) => (
                        <div key={l as string} style={{ background: C.card, borderRadius: 10, padding: "8px 10px", border: `1px solid ${C.line}` }}>
                          <div style={{ fontSize: 10.5, textTransform: "uppercase", color: C.dim, fontWeight: 700 }}>{l}</div>
                          <div style={{ fontSize: 15, fontWeight: 600 }}>{aed(v as number)}</div>
                        </div>
                      ))}
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>{fresh.plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  </>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
              {pick && <a href={`https://books.zoho.com/app/${pick.orgId}#/invoices/${pick.invoiceId}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.dim, marginRight: "auto", display: "inline-flex", gap: 4, alignItems: "center" }}><ExternalLink size={12} /> {pick.number} in Zoho</a>}
              <button style={btn("ghost")} onClick={onClose}>Close</button>
              <button style={btn("ghost")} disabled={!!busy || (!markOnly && !pick)} onClick={() => run(true)}>
                {busy === "preview" ? <Loader2 size={13} className="spin" /> : null} Preview
              </button>
              <button style={{ ...btn("primary"), opacity: fresh?.ok ? 1 : 0.5 }} disabled={!fresh?.ok || !!busy} onClick={() => run(false)}
                title={fresh?.ok ? "" : "Preview these exact choices first"}>
                {busy === "post" ? <Loader2 size={13} className="spin" /> : null} {markOnly ? `Mark ${kind}` : "Post to Zoho"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
