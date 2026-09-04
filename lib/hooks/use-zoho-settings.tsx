"use client";

/* Zoho account config — one fetch, shared everywhere.
   /api/integrations/zoho/account-config makes two live Zoho Books calls
   (bank accounts + chart of accounts) on every hit. Before this, ReconView
   and InvoicesWorkbench each fetched it independently, and Radix unmounts
   inactive TabsContent by default — so switching between the Bank recon and
   Invoices workbench tabs (or even the recon sub-tabs) re-fired both calls
   every time. That's the direct path to Zoho rate limits.

   ZohoSettingsProvider fetches once per mount and every consumer below it
   reads the same state via useZohoSettings() — no component fetches this
   endpoint on its own anymore. Mount the provider only around the surfaces
   that actually need it (the reconciliation tabs), not the whole app, so
   pages with no Zoho concern never trigger this call. */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ZohoAccountMap } from "@/lib/integrations/zoho-banking";

export type ZohoAccount = { account_id: string; account_name: string; account_type: string };

export type ZohoAccountConfig = {
  gateways: string[];
  bankLineKinds: string[];
  bankAccounts: ZohoAccount[];
  allAccounts: ZohoAccount[];
  saved: ZohoAccountMap;
  effective: ZohoAccountMap;
  readiness: { gateway: string; missing: string[] }[];
  incomeReadiness: string[];
  kindReadiness: { kind: string; missing: string[] }[];
  fetchError: string | null;
};

type ZohoSettingsState = {
  config: ZohoAccountConfig | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const ZohoSettingsContext = createContext<ZohoSettingsState | null>(null);

export function ZohoSettingsProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ZohoAccountConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Guards React 18 dev StrictMode's double-invoked mount effect from
  // firing this off twice — each hit is two real Zoho API calls.
  const fetchedOnce = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/zoho/account-config");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setConfig(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedOnce.current) return;
    fetchedOnce.current = true;
    refresh();
  }, [refresh]);

  return (
    <ZohoSettingsContext.Provider value={{ config, loading, error, refresh }}>
      {children}
    </ZohoSettingsContext.Provider>
  );
}

export function useZohoSettings(): ZohoSettingsState {
  const ctx = useContext(ZohoSettingsContext);
  if (!ctx) throw new Error("useZohoSettings must be used within a ZohoSettingsProvider");
  return ctx;
}
