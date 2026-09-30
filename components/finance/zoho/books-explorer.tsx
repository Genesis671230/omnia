"use client";

/* Zoho Books explorer — every entity the generic action layer supports
 * (lib/integrations/zoho-books-actions.ts), in the organisation picked by the
 * page's Books selector: list, search, open a record, run its actions (void /
 * mark sent / email), create or update from JSON, delete, and sync.
 *
 * Writes go through a two-step confirm naming the organisation, need an
 * admin / finance login (enforced server-side) and land in zoho_action_log.
 * Entities the connection's OAuth scopes don't cover are shown locked with
 * the fix, instead of failing with Zoho's "not authorized". */

import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Lock, Pencil, Plus, RefreshCcw, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { withZohoOrg } from "./org-picker";

type EntityInfo = {
  name: string; label: string; idField: string; scope: string; incremental: boolean; locked: boolean;
  operations: string[]; actions: { name: string; label: string }[];
  lastSync: { last_run_at: string | null; last_count: number; last_error: string } | null;
};
type Registry = { organisation: { id: string; label: string; orgId: string } | null; scopesKnown: boolean; entities: EntityInfo[]; error?: string };
type Rec = Record<string, unknown>;

const TEMPLATES: Record<string, Rec> = {
  invoices: { customer_id: "", date: "YYYY-MM-DD", reference_number: "", line_items: [{ item_id: "", quantity: 1, rate: 0 }] },
  creditnotes: { customer_id: "", date: "YYYY-MM-DD", line_items: [{ item_id: "", quantity: 1, rate: 0 }] },
  estimates: { customer_id: "", date: "YYYY-MM-DD", line_items: [{ item_id: "", quantity: 1, rate: 0 }] },
  purchaseorders: { vendor_id: "", date: "YYYY-MM-DD", line_items: [{ item_id: "", quantity: 1, rate: 0 }] },
  bills: { vendor_id: "", bill_number: "", date: "YYYY-MM-DD", line_items: [{ account_id: "", quantity: 1, rate: 0 }] },
  expenses: { account_id: "", paid_through_account_id: "", date: "YYYY-MM-DD", amount: 0, description: "" },
  journals: { journal_date: "YYYY-MM-DD", reference_number: "", notes: "", line_items: [{ account_id: "", debit_or_credit: "debit", amount: 0 }, { account_id: "", debit_or_credit: "credit", amount: 0 }] },
  payments: { customer_id: "", payment_mode: "banktransfer", amount: 0, date: "YYYY-MM-DD", account_id: "", reference_number: "", invoices: [{ invoice_id: "", amount_applied: 0 }] },
  vendorpayments: { vendor_id: "", amount: 0, date: "YYYY-MM-DD", paid_through_account_id: "", bills: [{ bill_id: "", amount_applied: 0 }] },
  contacts: { contact_name: "", contact_type: "customer" },
  items: { name: "", rate: 0 },
  chartofaccounts: { account_name: "", account_type: "expense" },
  bankaccounts: { account_name: "", account_type: "bank" },
};

const pickKey = (r: Rec, keys: string[]) => keys.find((k) => r[k] != null && r[k] !== "");
const COLS: { title: string; keys: string[]; align?: "right" }[] = [
  { title: "Number / name", keys: ["invoice_number", "creditnote_number", "bill_number", "estimate_number", "purchaseorder_number", "payment_number", "entry_number", "account_name", "contact_name", "name", "tax_name", "currency_code", "reference_number"] },
  { title: "Party / type", keys: ["customer_name", "vendor_name", "company_name", "account_type", "contact_type", "currency_name"] },
  { title: "Date", keys: ["date", "journal_date", "created_time"] },
  { title: "Status", keys: ["status", "reference_number"] },
  { title: "Amount", keys: ["total", "amount", "balance", "rate", "tax_percentage", "exchange_rate"], align: "right" },
];
const show = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v ?? "—")).slice(0, 60);

async function jfetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

function Confirm({ label, orgLabel, danger, busy, onConfirm, icon }: { label: string; orgLabel: string; danger?: boolean; busy: boolean; onConfirm: () => void; icon?: React.ReactNode }) {
  const [armed, setArmed] = useState(false);
  const base = `inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition disabled:opacity-50`;
  if (!armed) return <button className={`${base} border border-[#C9D5EA] bg-white text-[#0F1B3D] hover:border-[#1D4ED8]`} onClick={() => setArmed(true)} disabled={busy}>{icon}{label}</button>;
  return (
    <span className="inline-flex items-center gap-1">
      <button className={`${base} ${danger ? "bg-[#DC2626] text-white" : "bg-[#1D4ED8] text-white"}`} onClick={() => { setArmed(false); onConfirm(); }} disabled={busy}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : icon} {label} in {orgLabel}
      </button>
      <button className={`${base} text-[#5E6B85]`} onClick={() => setArmed(false)} aria-label="Cancel"><X size={12} /></button>
    </span>
  );
}

function JsonEditor({ title, initial, orgLabel, onSubmit, onClose }: { title: string; initial: Rec; orgLabel: string; onSubmit: (body: Rec) => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    let body: Rec;
    try { body = JSON.parse(text); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Must be a JSON object"); } catch (e) { setErr(`Invalid JSON: ${(e as Error).message}`); return; }
    setBusy(true); setErr(null);
    try { await onSubmit(body); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-[#C9D5EA] bg-[#F7F9FE] p-3">
      <div className="mb-2 flex items-center justify-between text-[13px] font-semibold text-[#0F1B3D]">{title}<button onClick={onClose} aria-label="Close"><X size={15} /></button></div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={12}
        className="w-full rounded-lg border border-[#C9D5EA] bg-white p-3 font-mono text-[12px] leading-relaxed text-[#0F1B3D] focus:border-[#1D4ED8] focus:outline-none" />
      <p className="mt-1 text-[11.5px] text-[#8A96B5]">Zoho Books API field names. Only the fields you send are changed on update.</p>
      {err && <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-[#F9ECE7] px-3 py-2 text-[12px] text-[#A6472F]"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{err}</div>}
      <div className="mt-2 flex justify-end"><Confirm label="Save" orgLabel={orgLabel} busy={busy} onConfirm={() => void submit()} /></div>
    </div>
  );
}

export function BooksExplorer({ org }: { org: string }) {
  const [reg, setReg] = useState<Registry | null>(null);
  const [entity, setEntity] = useState<string>("invoices");
  const [rows, setRows] = useState<Rec[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Rec | null>(null);
  const [editor, setEditor] = useState<"create" | "update" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const ent = reg?.entities.find((e) => e.name === entity);
  const orgLabel = reg?.organisation?.label ?? "this organisation";

  const loadRegistry = useCallback(async () => {
    try { setReg(await jfetch(withZohoOrg("/api/zoho/books", org))); } catch (e) { setReg({ organisation: null, scopesKnown: false, entities: [], error: (e as Error).message }); }
  }, [org]);
  useEffect(() => { setReg(null); setOpen(null); setEditor(null); void loadRegistry(); }, [loadRegistry]);

  const loadList = useCallback(async () => {
    if (!ent || ent.locked) { setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), perPage: "50" });
      if (q) qs.set("search", q);
      const j = await jfetch(withZohoOrg(`/api/zoho/books/${entity}?${qs}`, org));
      setRows(j.records); setHasMore(j.hasMore);
    } catch (e) { setError((e as Error).message); setRows([]); } finally { setLoading(false); }
  }, [ent, entity, page, q, org]);
  useEffect(() => { void loadList(); }, [loadList]);

  const openRecord = async (r: Rec) => {
    if (!ent) return;
    setOpen(r); setEditor(null);
    try { const j = await jfetch(withZohoOrg(`/api/zoho/books/${entity}/${encodeURIComponent(String(r[ent.idField]))}`, org)); setOpen(j.record); } catch (e) { toast.error((e as Error).message); }
  };

  const act = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try { await fn(); toast.success(done); await loadList(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const recId = open && ent ? String(open[ent.idField]) : "";

  const sync = () => act("sync", async () => {
    const j = await jfetch(withZohoOrg(`/api/zoho/books/${entity}/sync`, org), { method: "POST" });
    toast.message(`${j.written} ${ent?.label.toLowerCase()} synced${j.done ? "" : " — more to go, run again"}`);
    await loadRegistry();
  }, "Sync finished");

  const detailRows = useMemo(() => open ? Object.entries(open).filter(([, v]) => v !== null && v !== "" && typeof v !== "object").slice(0, 40) : [], [open]);

  if (reg?.error) return <div className="rounded-2xl bg-[#F9ECE7] px-4 py-3 text-[13px] text-[#A6472F]">{reg.error}</div>;
  if (!reg) return <div className="flex items-center gap-2 rounded-2xl bg-white p-8 text-[13px] text-[#5E6B85]"><Loader2 size={16} className="animate-spin" /> Loading Zoho Books…</div>;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      {/* entities */}
      <nav className="rounded-2xl border border-[#D8E1F1] bg-white p-2" aria-label="Zoho Books entities">
        <div className="px-2 pb-2 pt-1 text-[11.5px] font-medium uppercase tracking-[0.08em] text-[#8A96B5]">{orgLabel}</div>
        {reg.entities.map((e) => (
          <button key={e.name} onClick={() => { setEntity(e.name); setPage(1); setQ(""); setSearch(""); setOpen(null); setEditor(null); }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition ${entity === e.name ? "bg-[#0F1B3D] text-white" : "text-[#0F1B3D] hover:bg-[#F3F6FC]"}`}>
            {e.label}
            {e.locked && <Lock size={12} className={entity === e.name ? "text-white/70" : "text-[#A6472F]"} aria-label="Not granted" />}
          </button>
        ))}
      </nav>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#D8E1F1] bg-white px-4 py-3">
          <h3 className="text-[15px] font-semibold text-[#0F1B3D]">{ent?.label}</h3>
          {ent?.lastSync?.last_run_at && <span className="text-[12px] text-[#5E6B85]">synced {new Date(ent.lastSync.last_run_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
          <form onSubmit={(e) => { e.preventDefault(); setPage(1); setQ(search.trim()); }} className="relative ml-auto">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#5E6B85]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" disabled={ent?.locked}
              className="h-9 w-52 rounded-full border-0 bg-[#F3F6FC] pl-8 pr-3 text-[13px] ring-1 ring-inset ring-[#D8E1F1] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]" />
          </form>
          <button onClick={sync} disabled={!!busy || ent?.locked} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#C9D5EA] bg-white px-3 text-[12.5px] font-medium text-[#0F1B3D] hover:border-[#1D4ED8] disabled:opacity-50">
            {busy === "sync" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />} Sync
          </button>
          {ent?.operations.includes("create") && (
            <button onClick={() => { setOpen(null); setEditor("create"); }} disabled={ent.locked} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1D4ED8] px-3.5 text-[12.5px] font-medium text-white hover:bg-[#1E40AF] disabled:opacity-50">
              <Plus size={13} /> New
            </button>
          )}
        </div>

        {ent?.locked && (
          <div className="flex items-start gap-2 rounded-2xl bg-[#FFF7ED] px-4 py-3 text-[13px] text-[#7C2D12] ring-1 ring-[#FED7AA]">
            <Lock size={15} className="mt-0.5 shrink-0" />
            <span>This connection’s Zoho token wasn’t granted <b>ZohoBooks.{ent.scope}</b>. Regenerate the refresh token with scope <code className="rounded bg-white/70 px-1">ZohoBooks.fullaccess.all</code>, then update the organisation in Settings.</span>
          </div>
        )}

        {editor === "create" && ent && (
          <JsonEditor title={`New ${ent.label.replace(/s$/, "").toLowerCase()}`} initial={TEMPLATES[ent.name] ?? {}} orgLabel={orgLabel} onClose={() => setEditor(null)}
            onSubmit={async (body) => { const j = await jfetch(withZohoOrg(`/api/zoho/books/${entity}`, org), { method: "POST", body: JSON.stringify(body) }); toast.success("Created in Zoho"); setEditor(null); await loadList(); setOpen(j.record); }} />
        )}

        {open && ent && (
          <div className="rounded-2xl border border-[#D8E1F1] bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-[#0F1B3D]">{show(open[pickKey(open, COLS[0].keys) ?? ent.idField])}</span>
              <span className="font-mono text-[11.5px] text-[#8A96B5]">{recId}</span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                {ent.actions.map((a) => (
                  <Confirm key={a.name} label={a.label} orgLabel={orgLabel} danger={a.name === "void"} busy={busy === a.name}
                    onConfirm={() => void act(a.name, () => jfetch(withZohoOrg(`/api/zoho/books/${entity}/${encodeURIComponent(recId)}/${a.name}`, org), { method: "POST" }), `${a.label}: done`)} />
                ))}
                {ent.operations.includes("update") && <button onClick={() => setEditor("update")} className="inline-flex items-center gap-1.5 rounded-lg border border-[#C9D5EA] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#0F1B3D] hover:border-[#1D4ED8]"><Pencil size={12} /> Edit</button>}
                {ent.operations.includes("delete") && (
                  <Confirm label="Delete" orgLabel={orgLabel} danger icon={<Trash2 size={12} />} busy={busy === "delete"}
                    onConfirm={() => void act("delete", async () => { await jfetch(withZohoOrg(`/api/zoho/books/${entity}/${encodeURIComponent(recId)}`, org), { method: "DELETE" }); setOpen(null); }, "Deleted in Zoho")} />
                )}
                <button onClick={() => setOpen(null)} className="rounded-lg p-1.5 text-[#5E6B85] hover:bg-[#F3F6FC]" aria-label="Close"><X size={15} /></button>
              </div>
            </div>
            {editor === "update" && (
              <div className="mb-3">
                <JsonEditor title="Fields to change" initial={{}} orgLabel={orgLabel} onClose={() => setEditor(null)}
                  onSubmit={async (body) => { const j = await jfetch(withZohoOrg(`/api/zoho/books/${entity}/${encodeURIComponent(recId)}`, org), { method: "PUT", body: JSON.stringify(body) }); toast.success("Updated in Zoho"); setEditor(null); setOpen(j.record); await loadList(); }} />
              </div>
            )}
            <dl className="grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
              {detailRows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-[#F1F4FA] py-1"><dt className="text-[#5E6B85]">{k}</dt><dd className="truncate text-right text-[#0F1B3D]">{show(v)}</dd></div>
              ))}
            </dl>
            <details className="mt-3"><summary className="cursor-pointer text-[12px] text-[#1D4ED8]">Full record (JSON)</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-[#0F1B3D] p-3 text-[11.5px] leading-relaxed text-[#DCE4FF]">{JSON.stringify(open, null, 2)}</pre>
            </details>
          </div>
        )}

        {!ent?.locked && (
          <div className="overflow-hidden rounded-2xl border border-[#D8E1F1] bg-white">
            {error && <div className="bg-[#F9ECE7] px-4 py-2.5 text-[12.5px] text-[#A6472F]">{error}</div>}
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="bg-[#F7F9FE] text-left text-[11px] font-medium uppercase tracking-[0.08em] text-[#8A96B5]">
                  {COLS.map((c) => <th key={c.title} className={`px-4 py-2.5 ${c.align === "right" ? "text-right" : ""}`}>{c.title}</th>)}
                </tr></thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={COLS.length} className="px-4 py-8 text-center text-[#5E6B85]"><Loader2 size={16} className="mx-auto animate-spin" /></td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={COLS.length} className="px-4 py-8 text-center text-[#5E6B85]">No records{q ? ` for “${q}”` : ""}.</td></tr>
                  ) : rows.map((r, i) => (
                    <tr key={String(r[ent?.idField ?? ""] ?? i)} onClick={() => void openRecord(r)} className={`cursor-pointer border-t border-[#F1F4FA] hover:bg-[#F7F9FE] ${open && ent && open[ent.idField] === r[ent.idField] ? "bg-[#EEF3FF]" : ""}`}>
                      {COLS.map((c) => { const k = pickKey(r, c.keys); return <td key={c.title} className={`px-4 py-2.5 ${c.align === "right" ? "text-right tabular-nums" : ""} ${c === COLS[0] ? "font-medium text-[#0F1B3D]" : "text-[#46546F]"}`}>{k ? show(r[k]) : "—"}</td>; })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[#F1F4FA] px-4 py-2 text-[12px] text-[#5E6B85]">
              Page {page}
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading} className="rounded-lg p-1 hover:bg-[#F3F6FC] disabled:opacity-40" aria-label="Previous page"><ChevronLeft size={15} /></button>
              <button onClick={() => setPage((p) => p + 1)} disabled={!hasMore || loading} className="rounded-lg p-1 hover:bg-[#F3F6FC] disabled:opacity-40" aria-label="Next page"><ChevronRight size={15} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
