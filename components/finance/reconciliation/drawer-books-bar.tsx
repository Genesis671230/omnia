"use client";

/* "Close invoices in: [organisation]" — the first thing in the payout drawer.
 *
 * Loads the connected Zoho organisations the moment the drawer opens and shows
 * which one this payout closes invoices in, plus what was loaded from it (its
 * clearing / fee accounts and taxes). Switching saves onto the payout
 * (PUT /api/payouts/:id/zoho-org) and remounts the booking panels so every
 * account list, invoice lookup and posting below uses the new organisation.
 * Switchable at any time: orders already in Zoho are pinned to the books they
 * were booked in (server side), and each order row has its own picker for
 * payouts that mix House of Omnia and Omniastores orders. Only booked COD
 * delivery-charge documents (payout-level) still hold the payout in place. */

import { Building2, Check, Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useZohoOrgs } from "@/components/finance/zoho/org-picker";
import type { ReconLine } from "./types";

type State = { zohoConnectionId: string; booked: boolean; bookedCount: number; bookedOrders?: number; deliveryDocs?: number; locked?: boolean; ordersInOtherOrgs?: number };
type Loaded = { deposit: number; fee: number; taxes: number } | "error" | null;

export function DrawerBooksBar({ line, onSwitched }: { line: ReconLine; onSwitched: () => void }) {
  const { orgs, loading: orgsLoading } = useZohoOrgs();
  const payoutId = line.payout?.id ?? null;
  const [state, setState] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>(null);

  useEffect(() => {
    if (!payoutId) return;
    let live = true;
    fetch(`/api/payouts/${encodeURIComponent(payoutId)}/zoho-org`).then((r) => r.json()).then((j) => { if (live && !j.error) setState(j); });
    return () => { live = false; };
  }, [payoutId]);

  // What the booking panels will offer — read from the payout's organisation.
  useEffect(() => {
    if (!state) return;
    let live = true;
    setLoaded(null);
    fetch(`/api/settlements/posting-options?bankLineId=${encodeURIComponent(line.id)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; })
      .then((j) => { if (live) setLoaded({ deposit: j.depositAccounts?.length ?? 0, fee: j.feeAccounts?.length ?? 0, taxes: j.taxes?.length ?? 0 }); })
      .catch(() => { if (live) setLoaded("error"); });
    return () => { live = false; };
  }, [state, line.id]);

  const usable = orgs.filter((o) => o.status !== "disabled");
  const current = usable.find((o) => o.id === state?.zohoConnectionId) ?? orgs.find((o) => o.id === state?.zohoConnectionId);

  const switchTo = async (id: string) => {
    if (!payoutId || id === state?.zohoConnectionId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/payouts/${encodeURIComponent(payoutId)}/zoho-org`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zohoConnectionId: id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setState(j);
      toast.success(`Invoices on this payout now close in ${usable.find((o) => o.id === id)?.label ?? id}`);
      onSwitched();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#D8E1F1] bg-[#F7F9FE] px-5 py-3 sm:px-6">
      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#0F1B3D]">
        <Building2 size={14} className="text-[#1D4ED8]" aria-hidden /> Close invoices in
      </span>

      {!payoutId ? (
        <span className="text-[12.5px] text-[#5E6B85]">Attach this credit’s payout file first — the books are chosen for the payout.</span>
      ) : orgsLoading || !state ? (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#5E6B85]"><Loader2 size={13} className="animate-spin" /> Loading organisations…</span>
      ) : (
        <>
          <select
            value={state.zohoConnectionId}
            onChange={(e) => void switchTo(e.target.value)}
            disabled={saving || !!state.locked || usable.length < 2}
            aria-label="Zoho organisation this payout closes invoices in"
            className="h-8 rounded-lg border-0 bg-white px-2.5 text-[13px] font-medium text-[#0F1B3D] ring-1 ring-inset ring-[#C9D5EA] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] disabled:opacity-80"
          >
            {usable.map((o) => <option key={o.id} value={o.id}>{o.label}{o.orgName && o.orgName !== o.label ? ` — ${o.orgName}` : ""}</option>)}
            {!current && <option value={state.zohoConnectionId}>{state.zohoConnectionId}</option>}
          </select>
          {saving && <Loader2 size={14} className="animate-spin text-[#1D4ED8]" />}
          {state.locked ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-[#5E6B85]" title="COD delivery-charge documents are booked in this organisation">
              <Lock size={12} /> delivery charges booked here — pick the books per order below
            </span>
          ) : usable.length < 2 ? (
            <span className="text-[12px] text-[#5E6B85]">Connect another organisation in Settings to switch.</span>
          ) : (
            <span className="text-[12px] text-[#5E6B85]">
              {state.bookedOrders ? `${state.bookedOrders} booked order${state.bookedOrders === 1 ? "" : "s"} stay where booked · ` : ""}
              {state.ordersInOtherOrgs ? <b className="font-medium text-[#8A5A00]">{state.ordersInOtherOrgs} order{state.ordersInOtherOrgs === 1 ? "" : "s"} in another organisation · </b> : null}
              change any order&apos;s books on its row
            </span>
          )}
          <span className="ml-auto text-[12px] text-[#5E6B85]">
            {loaded === null ? <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> loading its accounts…</span>
              : loaded === "error" ? <span className="text-[#A6472F]">couldn’t load its accounts</span>
              : <span className="inline-flex items-center gap-1"><Check size={12} className="text-emerald-600" /> {loaded.deposit} deposit · {loaded.fee} expense accounts · {loaded.taxes} taxes{current ? ` from ${current.orgName || current.label}` : ""}</span>}
          </span>
        </>
      )}
    </div>
  );
}
