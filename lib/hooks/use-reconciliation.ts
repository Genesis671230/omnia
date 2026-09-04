"use client";

/* Bank-first recon state, owned in one hook instead of the workspace
   component. /api/reconcile is DB-only (no Zoho calls), so the 60s poll
   here is safe to leave running — but it's still gated behind `enabled` so
   it doesn't tick on views that never look at recon data (dashboard,
   marketing, inventory, …). */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ReconPayload } from "@/components/finance/reconciliation/types";

export function useReconciliation(enabled: boolean) {
  const [recon, setRecon] = useState<ReconPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dashVersion, setDashVersion] = useState(0);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const refresh = useCallback(async () => {
    setDashVersion((v) => v + 1);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const qs = params.toString();
      const r = await fetch(`/api/reconcile${qs ? `?${qs}` : ""}`).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setRecon(r);
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh, enabled]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST", body: JSON.stringify({}) });
      const json = await res.json();
      for (const r of json.results ?? []) {
        if (r.error) toast.error(`${r.store}: ${r.error}`);
        else toast.success(`${r.store}: ${r.fetched} orders synced`);
      }
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  const onConfirm = useCallback(async (bankLineId: string) => {
    const res = await fetch("/api/reconcile/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankLineId, actor: "founder" }),
    });
    if (res.ok) { toast.success("Settlement confirmed"); refresh(); }
    else toast.error("Confirm failed");
  }, [refresh]);

  const onRange = useCallback((f: string, t: string) => {
    setFromDate(f);
    setToDate(t);
  }, []);

  return { recon, loading, syncing, dashVersion, fromDate, toDate, onRange, refresh, sync, onConfirm };
}
