"use client";

/* Settings → Zoho organisations. Where a second (third…) set of books is
 * connected, checked and routed — the same flow onboarding will reuse.
 *
 *   1. paste Zoho "Self Client" credentials (client id, secret, refresh token)
 *   2. "Find organisations" asks Zoho which orgs those credentials can reach
 *   3. pick one, name it, connect → stored encrypted (lib/integrations/zoho-org.ts)
 *
 * Routing: a provider (e.g. COD / OnTrack vouchers) can be sent to an
 * organisation by default, so uploads land in the right books without anyone
 * choosing each time. The main (env) organisation takes everything unrouted. */

import { AlertTriangle, Building2, Check, CheckCircle2, KeyRound, Loader2, Plus, Power, RefreshCcw, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useZohoOrgs, type ZohoOrg } from "./org-picker";

const PROVIDERS = ["COD", "Telr", "Tabby", "Tamara", "Stripe", "Checkout", "Shopify Payments"];
const REGIONS = [
  ["https://accounts.zoho.com", "Global (.com)"],
  ["https://accounts.zoho.sa", "Saudi Arabia (.sa)"],
  ["https://accounts.zoho.eu", "Europe (.eu)"],
  ["https://accounts.zoho.in", "India (.in)"],
  ["https://accounts.zoho.com.au", "Australia (.com.au)"],
] as const;

type Discovered = { orgId: string; name: string; currency: string; isDefault: boolean };

const input = "h-10 w-full rounded-xl border border-[#C9D5EA] bg-white px-3 text-[13.5px] text-[#0F1B3D] placeholder:text-[#9AA6C8] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#C9D5EA] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#0F1B3D] transition hover:border-[#1D4ED8] disabled:opacity-50";
const primary = "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#1D4ED8] px-4 text-[13.5px] font-medium text-white transition hover:bg-[#1E40AF] disabled:opacity-50";

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function StatusDot({ o }: { o: ZohoOrg }) {
  const c = o.status === "disabled" ? "bg-slate-300" : o.status === "error" ? "bg-[#DC2626]" : "bg-emerald-500";
  const t = o.status === "disabled" ? "Disabled" : o.status === "error" ? "Needs attention" : "Connected";
  return <span className="inline-flex items-center gap-1.5 text-[12px] text-[#5E6B85]"><i className={`h-2 w-2 rounded-full ${c}`} />{t}</span>;
}

function OrgRow({ o, routedElsewhere, onChanged }: { o: ZohoOrg; routedElsewhere: Set<string>; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try { await fn(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const test = () => run("test", async () => {
    const r = await api(`/api/integrations/zoho/connections/${o.id}`, { method: "POST" });
    if (r.ok) toast.success(`${o.label}: connected to ${r.orgName}`); else toast.error(`${o.label}: ${r.error}`);
    onChanged();
  });
  const toggle = () => run("toggle", async () => {
    await api(`/api/integrations/zoho/connections/${o.id}`, { method: "PATCH", body: JSON.stringify({ status: o.status === "disabled" ? "active" : "disabled" }) });
    onChanged();
  });
  const route = (p: string) => run(`route:${p}`, async () => {
    const next = o.defaultForProviders.includes(p) ? o.defaultForProviders.filter((x) => x !== p) : [...o.defaultForProviders, p];
    await api(`/api/integrations/zoho/connections/${o.id}`, { method: "PATCH", body: JSON.stringify({ defaultForProviders: next }) });
    toast.success(o.defaultForProviders.includes(p) ? `${p} uploads go to the main organisation` : `${p} uploads now settle into ${o.label}`);
    onChanged();
  });
  const remove = () => run("delete", async () => {
    await api(`/api/integrations/zoho/connections/${o.id}`, { method: "DELETE" });
    toast.success(`${o.label} removed`);
    onChanged();
  });

  const main = o.source === "env";
  return (
    <div className="rounded-xl border border-[#E3E9F5] p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${main ? "bg-[#0F1B3D] text-white" : "bg-[#EEF3FF] text-[#1D4ED8]"}`}><Building2 size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14.5px] font-semibold text-[#0F1B3D]">{o.label}</span>
            {main && <span className="rounded-full bg-[#F3F6FC] px-2 py-0.5 text-[11px] text-[#5E6B85]">Main · from environment</span>}
            <StatusDot o={o} />
          </div>
          <div className="mt-0.5 text-[12.5px] text-[#5E6B85]">
            {o.orgName && o.orgName !== o.label ? `${o.orgName} · ` : ""}org {o.orgId}{o.loginEmail ? ` · ${o.loginEmail}` : ""}
            {o.lastCheckedAt && ` · checked ${new Date(o.lastCheckedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
          </div>
          {o.status === "error" && o.lastError && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-[#F9ECE7] px-3 py-2 text-[12px] text-[#A6472F]"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{o.lastError}</div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button className={btn} onClick={test} disabled={!!busy}>{busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />} Test</button>
          {!main && (
            <>
              <button className={btn} onClick={toggle} disabled={!!busy}><Power size={13} /> {o.status === "disabled" ? "Enable" : "Disable"}</button>
              {confirmDelete ? (
                <span className="inline-flex items-center gap-1">
                  <button className={`${btn} border-[#F3B3BF] text-[#A6472F]`} onClick={remove} disabled={!!busy}>{busy === "delete" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Remove</button>
                  <button className={btn} onClick={() => setConfirmDelete(false)} aria-label="Cancel"><X size={13} /></button>
                </span>
              ) : (
                <button className={btn} onClick={() => setConfirmDelete(true)} disabled={!!busy} aria-label={`Remove ${o.label}`}><Trash2 size={13} /></button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-3 border-t border-[#EEF2F9] pt-3">
        <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-[#8A96B5]">Uploads that settle into these books</div>
        {main ? (
          <p className="text-[12.5px] text-[#5E6B85]">Every provider not routed to another organisation.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {PROVIDERS.map((p) => {
              const on = o.defaultForProviders.includes(p);
              const taken = !on && routedElsewhere.has(p);
              return (
                <button key={p} onClick={() => route(p)} disabled={!!busy || o.status === "disabled"}
                  title={taken ? `${p} is routed to another organisation — this moves it here` : undefined}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] transition ${on ? "bg-[#1D4ED8] text-white" : "bg-[#F3F6FC] text-[#5E6B85] hover:bg-[#E3EBFB]"} ${taken ? "ring-1 ring-dashed ring-[#C9D5EA]" : ""}`}>
                  {busy === `route:${p}` ? <Loader2 size={11} className="animate-spin" /> : on ? <Check size={11} /> : null}
                  {p === "COD" ? "COD (OnTrack)" : p}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AddOrganisation({ connectedOrgIds, onDone }: { connectedOrgIds: Set<string>; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ clientId: "", clientSecret: "", refreshToken: "", accountsUrl: REGIONS[0][0] as string, loginEmail: "" });
  const [orgs, setOrgs] = useState<Discovered[] | null>(null);
  const [pick, setPick] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<"discover" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF((c) => ({ ...c, [k]: e.target.value })); setOrgs(null); };

  const reset = () => { setOpen(false); setF({ clientId: "", clientSecret: "", refreshToken: "", accountsUrl: REGIONS[0][0], loginEmail: "" }); setOrgs(null); setPick(""); setLabel(""); setError(null); };

  const discover = async () => {
    setBusy("discover"); setError(null);
    try {
      const r = await api("/api/integrations/zoho/connections", { method: "POST", body: JSON.stringify({ action: "discover", ...f }) });
      setOrgs(r.orgs);
      const first = (r.orgs as Discovered[]).find((o) => !connectedOrgIds.has(o.orgId));
      setPick(first?.orgId ?? ""); setLabel(first?.name ?? "");
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const save = async () => {
    setBusy("save"); setError(null);
    try {
      const r = await api("/api/integrations/zoho/connections", { method: "POST", body: JSON.stringify({ action: "save", ...f, orgId: pick, label }) });
      toast.success(`${r.connection.label} connected`);
      reset(); onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#C9D5EA] py-3.5 text-[13.5px] font-medium text-[#1D4ED8] transition hover:border-[#1D4ED8] hover:bg-[#F7F9FE]">
        <Plus size={16} /> Add a Zoho organisation
      </button>
    );
  }

  const ready = f.clientId.trim() && f.clientSecret.trim() && f.refreshToken.trim();
  return (
    <div className="rounded-xl border border-[#C9D5EA] bg-[#F7F9FE] p-4">
      <div className="mb-3 flex items-center gap-2">
        <KeyRound size={15} className="text-[#1D4ED8]" />
        <span className="text-[14px] font-semibold text-[#0F1B3D]">Connect another organisation</span>
        <button onClick={reset} className="ml-auto text-[#5E6B85] hover:text-[#0F1B3D]" aria-label="Close"><X size={16} /></button>
      </div>
      <p className="mb-3 text-[12.5px] leading-relaxed text-[#5E6B85]">
        In the Zoho account that owns the books, open <b>api-console.zoho.com → Self Client</b>, generate a code with the Zoho Books scopes, and exchange it for a refresh token. Paste the three values here. They are encrypted before they are stored.
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <input className={input} placeholder="Client ID  1000.XXXX…" value={f.clientId} onChange={set("clientId")} autoComplete="off" spellCheck={false} />
        <input className={input} placeholder="Client secret" type="password" value={f.clientSecret} onChange={set("clientSecret")} autoComplete="new-password" />
        <input className={`${input} sm:col-span-2`} placeholder="Refresh token  1000.xxxx…" type="password" value={f.refreshToken} onChange={set("refreshToken")} autoComplete="new-password" />
        <select className={input} value={f.accountsUrl} onChange={set("accountsUrl")} aria-label="Zoho data centre">
          {REGIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className={input} placeholder="Zoho login (optional) e.g. account@company.com" value={f.loginEmail} onChange={set("loginEmail")} />
      </div>

      {!orgs ? (
        <button onClick={discover} disabled={!ready || busy === "discover"} className={`${primary} mt-3`}>
          {busy === "discover" ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Find organisations
        </button>
      ) : (
        <div className="mt-4">
          <div className="mb-2 text-[12.5px] font-medium text-[#0F1B3D]">These credentials can reach {orgs.length} organisation{orgs.length === 1 ? "" : "s"}. Pick the one to connect:</div>
          <div className="space-y-1.5">
            {orgs.map((o) => {
              const connected = connectedOrgIds.has(o.orgId);
              return (
                <label key={o.orgId} className={`flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5 text-[13px] ${connected ? "cursor-not-allowed border-[#E3E9F5] opacity-60" : pick === o.orgId ? "cursor-pointer border-[#1D4ED8] ring-2 ring-[#1D4ED8]/15" : "cursor-pointer border-[#E3E9F5] hover:border-[#9FB4F2]"}`}>
                  <input type="radio" name="zoho-org" disabled={connected} checked={pick === o.orgId} onChange={() => { setPick(o.orgId); setLabel(o.name); }} className="accent-[#1D4ED8]" />
                  <span className="font-medium text-[#0F1B3D]">{o.name}</span>
                  <span className="text-[#8A96B5]">{o.orgId} · {o.currency}</span>
                  {connected && <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-emerald-700"><CheckCircle2 size={12} /> already connected</span>}
                </label>
              );
            })}
          </div>
          {pick && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name shown in the app, e.g. House of Omnia" aria-label="Organisation name" />
              <button onClick={save} disabled={!label.trim() || busy === "save"} className={`${primary} shrink-0`}>
                {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Connect
              </button>
            </div>
          )}
        </div>
      )}
      {error && <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-[#F9ECE7] px-3 py-2 text-[12.5px] text-[#A6472F]"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{error}</div>}
    </div>
  );
}

export function ZohoOrgsPanel() {
  const { orgs, error, loading, reload } = useZohoOrgs();
  const routed = (except: string) => new Set(orgs.filter((o) => o.id !== except).flatMap((o) => o.defaultForProviders));
  return (
    <div className="rounded-2xl border border-[#D8E1F1] bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <Building2 size={16} className="text-[#1D4ED8]" />
        <h3 className="text-[15px] font-semibold text-[#0F1B3D]">Zoho organisations</h3>
        <button onClick={() => reload()} className={`${btn} ml-auto`}><RefreshCcw size={13} /> Reload</button>
      </div>
      <p className="mb-4 text-[12.5px] text-[#5E6B85]">Each set of books the platform reads and posts to. Payouts close invoices in the organisation they settle into.</p>
      {loading && orgs.length === 0 ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-[#5E6B85]"><Loader2 size={15} className="animate-spin" /> Loading organisations…</div>
      ) : error ? (
        <div className="rounded-xl bg-[#F9ECE7] px-4 py-3 text-[13px] text-[#A6472F]">{error}</div>
      ) : (
        <div className="space-y-3">
          {orgs.map((o) => <OrgRow key={o.id} o={o} routedElsewhere={routed(o.id)} onChanged={() => reload()} />)}
          <AddOrganisation connectedOrgIds={new Set(orgs.map((o) => o.orgId))} onDone={() => reload()} />
        </div>
      )}
    </div>
  );
}
