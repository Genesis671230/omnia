"use client";

/* Leads inbox — every RAMZA form submission (hero, free tools, contact,
   payout audit) with one-tap WhatsApp / email and a follow-up status.
   Telegram still pings on each new lead (lib/ramza/leads.ts); this is where
   they're worked. Polls every 60s so a lead seen on Telegram is already here. */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, MessageCircle, RefreshCw, Search } from "lucide-react";

type Lead = {
  id: string; created_at: string; name: string; whatsapp: string; email: string; company: string; store_url: string;
  situation: string; penalty_type: string; penalty_issued_on: string | null; checker: Record<string, unknown> | null;
  gateways: string[]; monthly_orders: string; accounting_tool: string;
  utm_source: string; utm_campaign: string; utm_content: string; landing_path: string; source: string;
  status: string; notes: string; contacted_at: string | null;
};

const STATUSES = ["new", "contacted", "qualified", "call-booked", "won", "lost"] as const;
const STATUS_TONE: Record<string, string> = {
  new: "bg-amber-50 text-amber-700 ring-amber-200", contacted: "bg-sky-50 text-sky-700 ring-sky-200",
  qualified: "bg-violet-50 text-violet-700 ring-violet-200", "call-booked": "bg-indigo-50 text-indigo-700 ring-indigo-200",
  won: "bg-emerald-50 text-emerald-700 ring-emerald-200", lost: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};
const NEED: Record<string, string> = {
  einvoicing: "E-invoicing setup", file_return: "CT return", missed_deadline: "Missed CT deadline", books_behind: "Books behind",
  got_penalty: "Got a penalty", register_or_file: "Register / file", vat: "VAT", other: "Other",
};

const waLink = (n: string, name: string) => {
  const digits = n.replace(/[^\d]/g, "").replace(/^00/, "").replace(/^0(?=5)/, "971");
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Hi ${name.split(" ")[0] || ""}, this is RAMZA — thanks for your request.`)}`;
};
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dubai" });
};
const needOf = (l: Lead) => (l.source === "ramza-landing" ? "Payout audit" : NEED[l.situation] ?? (l.situation || "—"));

export function LeadsInbox() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const r = await fetch(`/api/leads?days=365`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setLeads(j.leads);
    } catch (e) {
      if (!quiet) toast.error(`Leads: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const patch = async (id: string, body: { status?: string; notes?: string }) => {
    const prev = leads;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, ...body } : l)));
    const r = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { setLeads(prev); toast.error("Could not save"); }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: leads.length };
    for (const l of leads) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [leads]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return leads.filter((l) => (status === "all" || l.status === status) && (!t || [l.name, l.company, l.email, l.whatsapp, l.utm_campaign, needOf(l)].join(" ").toLowerCase().includes(t)));
  }, [leads, status, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", ...STATUSES] as string[]).map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1.5 text-[13px] ring-1 transition ${status === s ? "bg-foreground text-background ring-foreground" : "bg-card text-muted-foreground ring-border hover:text-foreground"}`}>
            {s === "all" ? "All" : s.replace("-", " ")} <span className="tabular-nums opacity-70">{counts[s] ?? 0}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13px]">
            <Search size={14} className="text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, company, campaign…" className="w-48 bg-transparent outline-none" />
          </label>
          <button onClick={() => load()} className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] hover:bg-muted">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/50 text-left text-[11.5px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-4 py-2.5">When</th><th className="px-4 py-2.5">Lead</th><th className="px-4 py-2.5">Needs</th><th className="px-4 py-2.5">Source</th><th className="px-4 py-2.5">Contact</th><th className="px-4 py-2.5">Status</th></tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <Fragment key={l.id}>
                <tr onClick={() => setOpen(open === l.id ? null : l.id)} className={`cursor-pointer border-t border-border hover:bg-muted/40 ${l.status === "new" ? "font-medium" : ""}`}>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground" title={new Date(l.created_at).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}>{ago(l.created_at)}</td>
                  <td className="px-4 py-3"><div>{l.name}</div><div className="text-[12px] font-normal text-muted-foreground">{l.company || l.store_url || l.email}</div></td>
                  <td className="px-4 py-3">{needOf(l)}{l.checker && typeof l.checker.headline === "string" && <div className="max-w-[260px] truncate text-[12px] font-normal text-muted-foreground">{l.checker.headline}</div>}</td>
                  <td className="px-4 py-3 text-[12px] font-normal text-muted-foreground">{l.utm_campaign || l.utm_source || (l.landing_path || "direct")}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1.5">
                      <a href={waLink(l.whatsapp, l.name)} target="_blank" rel="noreferrer" onClick={() => l.status === "new" && patch(l.id, { status: "contacted" })} className="flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-[12px] font-medium text-white hover:bg-emerald-700"><MessageCircle size={13} /> WhatsApp</a>
                      <a href={`mailto:${l.email}`} className="flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[12px] hover:bg-muted"><Mail size={13} /></a>
                    </div>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <select value={l.status} onChange={(e) => patch(l.id, { status: e.target.value })} className={`rounded-full px-2.5 py-1 text-[12px] ring-1 ${STATUS_TONE[l.status] ?? STATUS_TONE.new}`}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s.replace("-", " ")}</option>)}
                    </select>
                  </td>
                </tr>
                {open === l.id && (
                  <tr className="border-t border-border bg-muted/20">
                    <td colSpan={6} className="px-4 py-4">
                      <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
                        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
                          <dt className="text-muted-foreground">WhatsApp</dt><dd className="tabular-nums">{l.whatsapp}</dd>
                          <dt className="text-muted-foreground">Email</dt><dd>{l.email}</dd>
                          {l.penalty_type && <><dt className="text-muted-foreground">Penalty</dt><dd>{l.penalty_type}{l.penalty_issued_on ? ` · notice ${l.penalty_issued_on}` : ""}</dd></>}
                          {!!l.gateways?.length && <><dt className="text-muted-foreground">Gateways</dt><dd>{l.gateways.join(", ")} · {l.monthly_orders} orders/mo · {l.accounting_tool}</dd></>}
                          <dt className="text-muted-foreground">Campaign</dt><dd>{[l.utm_source, l.utm_campaign, l.utm_content].filter(Boolean).join(" / ") || "—"}</dd>
                          <dt className="text-muted-foreground">Landed on</dt><dd>{l.landing_path || "—"}</dd>
                          {l.contacted_at && <><dt className="text-muted-foreground">Contacted</dt><dd>{new Date(l.contacted_at).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}</dd></>}
                          {l.checker && <><dt className="text-muted-foreground">Tool result</dt><dd><pre className="whitespace-pre-wrap text-[11.5px] text-muted-foreground">{JSON.stringify(l.checker, null, 1).slice(0, 800)}</pre></dd></>}
                        </dl>
                        <label className="block">
                          <span className="mb-1 block text-[12px] text-muted-foreground">Notes</span>
                          <textarea defaultValue={l.notes} onBlur={(e) => e.target.value !== l.notes && patch(l.id, { notes: e.target.value })} rows={5} className="w-full rounded-lg border border-border bg-card p-2.5 text-[13px] outline-none focus:ring-2 focus:ring-ring/30" placeholder="Call outcome, quote sent, next step…" />
                        </label>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!rows.length && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">{loading ? "Loading leads…" : "No leads match."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
