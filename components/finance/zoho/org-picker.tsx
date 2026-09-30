"use client";

/* Zoho organisation list + a compact picker.
 *
 *   const { orgs, reload } = useZohoOrgs();
 *   <ZohoOrgPicker value={org} onChange={setOrg} />
 *   fetch(withZohoOrg("/api/zoho/ledger?month=2026-09", org))
 *
 * The picker hides itself while only one organisation exists, so screens look
 * exactly as before until a second organisation is connected. The choice is
 * remembered per screen (localStorage), never shared between screens: the
 * ledger showing House of Omnia must not quietly switch the account mapping. */

import { Building2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export type ZohoOrg = {
  id: string;
  label: string;
  orgId: string;
  orgName: string;
  status: "active" | "error" | "disabled";
  lastError: string;
  lastCheckedAt: string | null;
  loginEmail: string;
  dailyBudget: number;
  defaultForProviders: string[];
  source: "env" | "db";
};

let shared: Promise<ZohoOrg[]> | null = null;

function fetchOrgs(force = false): Promise<ZohoOrg[]> {
  if (!shared || force) {
    shared = fetch("/api/integrations/zoho/connections", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return (j.connections ?? []) as ZohoOrg[];
      })
      .catch((e) => { shared = null; throw e; });
  }
  return shared;
}

export function useZohoOrgs() {
  const [orgs, setOrgs] = useState<ZohoOrg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async (force = true) => {
    setLoading(true);
    try { setOrgs(await fetchOrgs(force)); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(false); }, [reload]);
  return { orgs, error, loading, reload };
}

/** Adds ?zohoOrg= to a URL ("" / "env" = the main organisation, no param). */
export function withZohoOrg(url: string, org: string): string {
  if (!org || org === "env") return url;
  return `${url}${url.includes("?") ? "&" : "?"}zohoOrg=${encodeURIComponent(org)}`;
}

/** Per-screen remembered organisation. Falls back to main if the saved one is gone. */
export function useScreenZohoOrg(screen: string, initial = "env"): [string, (v: string) => void] {
  const key = `zohoOrg:${screen}`;
  const [org, setOrg] = useState(initial);
  useEffect(() => {
    try { const v = localStorage.getItem(key); if (v) setOrg(v); } catch { /* private mode */ }
  }, [key]);
  const set = useCallback((v: string) => {
    setOrg(v);
    try { localStorage.setItem(key, v); } catch { /* private mode */ }
  }, [key]);
  return [org, set];
}

export function ZohoOrgPicker({ value, onChange, label = "Books" }: { value: string; onChange: (v: string) => void; label?: string }) {
  const { orgs } = useZohoOrgs();
  const usable = orgs.filter((o) => o.status !== "disabled");
  // Saved choice no longer exists → show main rather than a blank control.
  useEffect(() => {
    if (usable.length && !usable.some((o) => o.id === value)) onChange("env");
  }, [usable, value, onChange]);
  if (usable.length < 2) return null;
  return (
    <label className="inline-flex items-center gap-2 rounded-full border border-[#D8E1F1] bg-white py-1 pl-3 pr-1 text-[12.5px] text-[#5E6B85]">
      <Building2 size={13} className="text-[#2347D9]" aria-hidden />
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded-full bg-[#EEF3FF] px-2.5 text-[12.5px] font-medium text-[#0A1A4A] focus:outline-none focus:ring-2 focus:ring-[#2347D9]/30"
        aria-label="Zoho organisation"
      >
        {usable.map((o) => (
          <option key={o.id} value={o.id}>{o.label}{o.status === "error" ? " (needs attention)" : ""}</option>
        ))}
      </select>
    </label>
  );
}

/** Small read-only tag: which organisation a payout settles into. */
export function ZohoOrgTag({ connectionId }: { connectionId?: string | null }) {
  const { orgs } = useZohoOrgs();
  if (!connectionId || orgs.length < 2) return null;
  const o = orgs.find((x) => x.id === connectionId);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF3FF] px-2 py-0.5 text-[11px] font-medium text-[#2347D9]" title={o ? `Settles into ${o.orgName || o.label} (${o.orgId})` : connectionId}>
      <Building2 size={11} aria-hidden /> {o?.label ?? connectionId}
    </span>
  );
}
