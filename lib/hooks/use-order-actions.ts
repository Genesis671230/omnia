"use client";

/* One place for every write against an order, so the ledger row, the invoice
   modal, and the ship modal all speak to the same endpoints with the same
   error handling. Each call returns the JSON body on success and throws a
   readable Error on failure (message pulled from the API's { error } field
   when present, otherwise the status text) — callers just try/catch and toast.

   Endpoint contract (confirmed against the existing app):
     PATCH /api/orders/:uid/status   { stage }                → { ok, stage }
     PATCH /api/orders/:uid/finance  { finance_status }       → { ok, finance_status }
     POST  /api/orders/:uid/zoho                              → { invoiceId, invoiceUrl }
     GET   /api/orders/:uid/zoho                              → { invoiceId, invoiceUrl, syncedAt }
     POST  /api/orders/:uid/zoho/sync                         → { invoiceId, invoiceUrl }
     POST  /api/orders/:uid/refund   { mode: 'cancel'|'refund' } → { ok, mode }
*/

import { useCallback, useState } from "react";
import type { OrderRow } from "@/lib/types/orders";

export type FinanceStatus = OrderRow["finance_status"];
export type ZohoState = { invoiceId: string; invoiceUrl: string; syncedAt?: string | null } | null;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init.headers || {}) } : init?.headers,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body?.error || msg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg || `Request failed (${res.status})`);
  }
  // Some routes return 204; guard the parse.
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export function useOrderActions(uid: string) {
  // one in-flight action at a time per order, so buttons can show their own spinner
  const [pending, setPending] = useState<null | "stage" | "finance" | "zoho" | "zoho-sync" | "cancel" | "refund">(null);

  const run = useCallback(async <T,>(key: NonNullable<typeof pending>, fn: () => Promise<T>): Promise<T> => {
    setPending(key);
    try {
      return await fn();
    } finally {
      setPending(null);
    }
  }, []);

  const advanceStage = useCallback(
    (stage: string) => run("stage", () =>
      call<{ ok: boolean; stage: string }>(`/api/orders/${uid}/status`, {
        method: "PATCH",
        body: JSON.stringify({ stage }),
      })),
    [uid, run],
  );

  const setFinanceStatus = useCallback(
    (finance_status: FinanceStatus) => run("finance", () =>
      call<{ ok: boolean; finance_status: FinanceStatus }>(`/api/orders/${uid}/finance`, {
        method: "PATCH",
        body: JSON.stringify({ finance_status }),
      })),
    [uid, run],
  );

  const pushToZoho = useCallback(
    () => run("zoho", () =>
      call<{ invoiceId: string; invoiceUrl: string }>(`/api/orders/${uid}/zoho`, { method: "POST" })),
    [uid, run],
  );

  const getZoho = useCallback(
    () => call<ZohoState>(`/api/orders/${uid}/zoho`).catch(() => null),
    [uid],
  );

  const resyncZoho = useCallback(
    () => run("zoho-sync", () =>
      call<{ invoiceId: string; invoiceUrl: string }>(`/api/orders/${uid}/zoho/sync`, { method: "POST" })),
    [uid, run],
  );

  const cancelOrder = useCallback(
    () => run("cancel", () =>
      call<{ ok: boolean; mode: "cancel" }>(`/api/orders/${uid}/refund`, {
        method: "POST",
        body: JSON.stringify({ mode: "cancel" }),
      })),
    [uid, run],
  );

  const refundOrder = useCallback(
    () => run("refund", () =>
      call<{ ok: boolean; mode: "refund" }>(`/api/orders/${uid}/refund`, {
        method: "POST",
        body: JSON.stringify({ mode: "refund" }),
      })),
    [uid, run],
  );

  return { pending, advanceStage, setFinanceStatus, pushToZoho, getZoho, resyncZoho, cancelOrder, refundOrder };
}