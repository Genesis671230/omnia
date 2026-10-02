"use client";

/* Which statement the Bank Transactions tab is showing — Omniastores SIB,
 * House of Omnia RAK, a credit card… Each account keeps its own lines and
 * books into its own Zoho organisation and Zoho bank / card account, set here.
 * Route: /api/statement-accounts. */

import { useState } from "react";
import { CreditCard, Landmark, Plus, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import type { StatementAccount } from "@/lib/finance/statement-accounts";
import { AccountCombobox } from "./account-combobox";

type ZohoAccount = { account_id: string; account_name: string; account_type: string };
export type ZohoOrgOption = { id: string; label: string };

export function StatementAccountBar({
  accounts, orgs, selectedId, onSelect, zohoAccounts, onSaved,
}: {
  accounts: StatementAccount[];
  orgs: ZohoOrgOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** The selected account's organisation's chart of accounts. */
  zohoAccounts: ZohoAccount[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<"edit" | "new" | null>(null);
  const selected = accounts.find((a) => a.id === selectedId);
  const orgLabel = (id: string) => orgs.find((o) => o.id === id)?.label ?? (id || "Main organisation");

  return (
    <div className="mb-4 rounded-2xl border border-[#D8E1F1] bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        {accounts.map((a) => {
          const Icon = a.kind === "credit_card" ? CreditCard : Landmark;
          const on = a.id === selectedId;
          return (
            <button key={a.id} onClick={() => onSelect(a.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] transition ${on ? "bg-[#0F1B3D] text-white" : "bg-[#F3F6FC] text-[#0F1B3D] hover:bg-[#E9EFFA]"}`}>
              <Icon size={13} /> {a.label}
            </button>
          );
        })}
        <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#C9D5EA] px-3 py-1.5 text-[12px] text-[#5E6B85] hover:text-[#0F1B3D]">
          <Plus size={12} /> Add account
        </button>
        {selected && (
          <button onClick={() => setEditing("edit")} className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-[#5E6B85] hover:text-[#0F1B3D]">
            <Settings2 size={13} /> Books into {orgLabel(selected.zohoConnectionId)}
            {selected.zohoAccountId
              ? ` · ${zohoAccounts.find((z) => z.account_id === selected.zohoAccountId)?.account_name ?? "Zoho account set"}`
              : <span className="text-[#A6472F]"> · Zoho account not set</span>}
          </button>
        )}
      </div>
      {editing && (
        <AccountEditor
          key={editing === "new" ? "new" : selected?.id}
          account={editing === "edit" ? selected ?? null : null}
          orgs={orgs}
          zohoAccounts={zohoAccounts}
          onClose={() => setEditing(null)}
          onSaved={(id) => { setEditing(null); onSaved(); onSelect(id); }}
        />
      )}
    </div>
  );
}

function AccountEditor({ account, orgs, zohoAccounts, onClose, onSaved }: {
  account: StatementAccount | null;
  orgs: ZohoOrgOption[];
  zohoAccounts: ZohoAccount[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [label, setLabel] = useState(account?.label ?? "");
  const [kind, setKind] = useState<StatementAccount["kind"]>(account?.kind ?? "bank");
  const [org, setOrg] = useState(account?.zohoConnectionId ?? "");
  const [zohoAccountId, setZohoAccountId] = useState(account?.zohoAccountId ?? "");
  const [hints, setHints] = useState((account?.matchHints ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  // The chart shown is the selected account's org's; after switching org the
  // Zoho account must be picked again once the account is saved and reloaded.
  const orgChanged = (account?.zohoConnectionId ?? "") !== org;

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/statement-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: account?.id, label, kind, zohoConnectionId: org,
          zohoAccountId: orgChanged ? "" : zohoAccountId,
          matchHints: hints.split(",").map((h) => h.trim()).filter(Boolean),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      toast.success(`${j.account.label} saved`);
      onSaved(j.account.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = "mt-1 w-full rounded-lg border border-[#C9D5EA] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#1D4ED8]";
  return (
    <div className="mt-3 rounded-xl border border-[#D8E1F1] bg-[#F7F9FD] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-[#0F1B3D]">{account ? `Edit ${account.label}` : "New statement account"}</div>
        <button onClick={onClose} aria-label="Close"><X size={15} className="text-[#5E6B85]" /></button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="text-[12px] text-[#0F1B3D]">Name
          <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Omnia Mohamed · Mashreq credit card" />
        </label>
        <label className="text-[12px] text-[#0F1B3D]">Type
          <select className={field} value={kind} onChange={(e) => setKind(e.target.value as StatementAccount["kind"])}>
            <option value="bank">Bank account</option>
            <option value="credit_card">Credit card</option>
          </select>
        </label>
        <label className="text-[12px] text-[#0F1B3D]">Zoho books
          <select className={field} value={org} onChange={(e) => setOrg(e.target.value)}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <div className="text-[12px] text-[#0F1B3D]">Zoho {kind === "credit_card" ? "credit card" : "bank"} account
          <div className="mt-1">
            {orgChanged
              ? <div className="rounded-lg border border-dashed border-[#C9D5EA] px-3 py-2 text-[12px] text-[#5E6B85]">Save first — then pick it from that organisation&apos;s accounts.</div>
              : <AccountCombobox accounts={zohoAccounts} value={zohoAccountId} placeholder="Pick the Zoho account" onChange={setZohoAccountId} />}
          </div>
        </div>
        <label className="text-[12px] text-[#0F1B3D] md:col-span-2">Recognise statements by (comma-separated — account number, card mask, holder name)
          <input className={field} value={hints} onChange={(e) => setHints(e.target.value)} placeholder="0333190982001, 546750XXXXXX6886" />
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <button onClick={save} disabled={busy || !label.trim()} className="rounded-full bg-[#0F1B3D] px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save account"}
        </button>
      </div>
    </div>
  );
}
