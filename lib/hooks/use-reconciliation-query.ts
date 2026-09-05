"use client";

/* Same public contract as lib/hooks/use-reconciliation.ts (the hook it
   replaces) — { recon, loading, syncing, dashVersion, fromDate, toDate,
   onRange, refresh, sync, onConfirm } — so finance-workspace.tsx needs only
   its import changed. Internals move from manual fetch+setInterval onto
   React Query: useQuery dedupes/caches by [fromDate, toDate] and keeps the
   existing 60s poll via refetchInterval; useMutation replaces the ad-hoc
   confirm/sync fetch calls with real pending/error state React Query
   already tracks. /api/reconcile is DB-only (no Zoho calls) — safe to poll
   the same as before. */

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ReconPayload } from "@/components/finance/reconciliation/types";

async function fetchRecon(fromDate: string, toDate: string): Promise<ReconPayload> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from", fromDate);
  if (toDate) params.set("to", toDate);
  const qs = params.toString();
  const r = await fetch(`/api/reconcile${qs ? `?${qs}` : ""}`).then((x) => x.json());
  if (r.error) throw new Error(r.error);
  return r as ReconPayload;
}

export function useReconciliation(enabled: boolean) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const queryClient = useQueryClient();

  const reconQuery = useQuery({
    queryKey: ["reconcile", fromDate, toDate],
    queryFn: () => fetchRecon(fromDate, toDate),
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["reconcile", fromDate, toDate] });
  }, [queryClient, fromDate, toDate]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/sync", { method: "POST", body: JSON.stringify({}) });
      return res.json();
    },
    onSuccess: async (json: { results?: { store: string; fetched?: number; error?: string }[] }) => {
      for (const r of json.results ?? []) {
        if (r.error) toast.error(`${r.store}: ${r.error}`);
        else toast.success(`${r.store}: ${r.fetched} orders synced`);
      }
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: async (bankLineId: string) => {
      const res = await fetch("/api/reconcile/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId, actor: "founder" }),
      });
      if (!res.ok) throw new Error("Confirm failed");
    },
    onSuccess: async () => { toast.success("Settlement confirmed"); await refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const onRange = useCallback((f: string, t: string) => {
    setFromDate(f);
    setToDate(t);
  }, []);

  return {
    recon: reconQuery.data ?? null,
    loading: reconQuery.isLoading,
    syncing: syncMutation.isPending,
    // dashVersion existed to force-remount version-keyed children on every
    // refresh (e.g. FounderDashboard) — React Query's own queryKey already
    // does that for anything reading `recon` reactively, but a couple of
    // call sites pass this as a literal remount key, so it's kept, driven by
    // the query's own fetch count instead of a separately-tracked counter.
    dashVersion: reconQuery.dataUpdatedAt,
    fromDate,
    toDate,
    onRange,
    refresh,
    sync: () => syncMutation.mutate(),
    onConfirm: (id: string) => confirmMutation.mutate(id),
  };
}
