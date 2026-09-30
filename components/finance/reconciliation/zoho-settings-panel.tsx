"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BookCheck, Check, Loader2, RefreshCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { gatewayColor } from "./colors";
import { ZohoOrgPicker, useScreenZohoOrg, withZohoOrg } from "@/components/finance/zoho/org-picker";

/* Zoho Books account mapping.
 *
 * Posting a payout moves money out of a per-gateway CLEARING account: net to
 * the bank, fee to the fee account. That needs three kinds of account id, and
 * they used to live only in environment variables — which meant a wrong id was
 * invisible until the moment a real payout was posted. Here they are visible,
 * checked against what Zoho actually has, and saved to the database.
 */

type Account = { account_id: string; account_name: string; account_type: string; is_active: boolean };

type Config = {
  gateways: string[];
  bankLineKinds: string[];
  bankAccounts: Account[];
  allAccounts: Account[];
  effective: {
    bankAccountId: string; feeAccountId: string; clearingByGateway: Record<string, string>;
    defaultIncomeAccountId: string; expenseAccountByKind: Record<string, string>;
  };
  readiness: { gateway: string; missing: string[] }[];
  incomeReadiness: string[];
  kindReadiness: { kind: string; missing: string[] }[];
  fetchError: string | null;
  error?: string;
};

function AccountSelect({ value, onChange, accounts, placeholder }: {
  value: string; onChange: (v: string) => void; accounts: Account[]; placeholder: string;
}) {
  // A saved id Zoho no longer knows about must stay visible rather than
  // silently resetting the dropdown to blank — that would look like the
  // mapping was never made.
  const known = accounts.some((a) => a.account_id === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-[#C9D5EA] bg-white px-3 py-2 text-[13px] text-[#0F1B3D] outline-none focus:border-[#1D4ED8]"
    >
      <option value="">{placeholder}</option>
      {value && !known && <option value={value}>⚠ {value} — not found in Zoho</option>}
      {accounts.map((a) => (
        <option key={a.account_id} value={a.account_id}>
          {a.account_name} · {a.account_type}
        </option>
      ))}
    </select>
  );
}

export function ZohoSettingsPanel() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bankAccountId, setBankAccountId] = useState("");
  const [feeAccountId, setFeeAccountId] = useState("");
  const [clearing, setClearing] = useState<Record<string, string>>({});
  const [incomeAccountId, setIncomeAccountId] = useState("");
  const [expenseByKind, setExpenseByKind] = useState<Record<string, string>>({});
  // Account ids differ per Zoho organisation, so each org has its own mapping.
  const [org, setOrg] = useScreenZohoOrg("account-mapping");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r: Config = await fetch(withZohoOrg("/api/integrations/zoho/account-config", org)).then((x) => x.json());
      setCfg(r);
      if (r.effective) {
        setBankAccountId(r.effective.bankAccountId || "");
        setFeeAccountId(r.effective.feeAccountId || "");
        setClearing(r.effective.clearingByGateway || {});
        setIncomeAccountId(r.effective.defaultIncomeAccountId || "");
        setExpenseByKind(r.effective.expenseAccountByKind || {});
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [org]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(withZohoOrg("/api/integrations/zoho/account-config", org), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankAccountId, feeAccountId, clearingByGateway: clearing,
          defaultIncomeAccountId: incomeAccountId, expenseAccountByKind: expenseByKind,
          actor: "founder",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success("Zoho account mapping saved");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-dashed border-[#C9D5EA] bg-white p-10 text-[14px] text-[#5E6B85]">
        <Loader2 size={18} className="animate-spin" /> Loading your Zoho chart of accounts…
      </div>
    );
  }

  if (cfg?.error) {
    return (
      <div className="rounded-2xl border border-[#D8E1F1] bg-white p-6">
        <div className="mb-3"><ZohoOrgPicker value={org} onChange={setOrg} label="Mapping for" /></div>
        <div className="flex items-start gap-2.5 rounded-xl bg-[#F9ECE7] px-4 py-3 text-[13px] leading-relaxed text-[#A6472F]">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{cfg.error}</span>
        </div>
      </div>
    );
  }

  const bankLike = cfg?.bankAccounts ?? [];
  const all = cfg?.allAccounts?.length ? cfg.allAccounts : bankLike;
  const ready = (cfg?.readiness ?? []).filter((r) => r.missing.length === 0).length;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#D8E1F1] bg-white p-5 shadow-sm">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <BookCheck size={16} className="text-[#1D4ED8]" />
          <h3 className="text-[15px] font-semibold text-[#0F1B3D]">Zoho Books posting accounts</h3>
          <ZohoOrgPicker value={org} onChange={setOrg} label="Mapping for" />
          <span className="ml-auto text-[12px] text-[#5E6B85]">
            {ready} of {cfg?.gateways.length ?? 0} gateways ready to post
          </span>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#C9D5EA] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#0F1B3D] hover:border-[#1D4ED8]"
          >
            <RefreshCcw size={13} /> Reload
          </button>
        </div>
        <p className="mb-4 max-w-3xl text-[13px] leading-relaxed text-[#5E6B85]">
          When a customer pays, the money sits with the gateway — recorded against that gateway&apos;s{" "}
          <b className="text-[#0F1B3D]">clearing account</b>. When the gateway wires you the batch, posting it here
          moves the net into your bank account and splits the fee off, emptying the clearing account by exactly what
          the gateway collected. That is why this is a transfer and not a deposit: a deposit would count the same cash
          twice, since each order already posts its own customer payment.
        </p>

        {cfg?.fetchError && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl bg-[#EAF1FD] px-4 py-3 text-[13px] leading-relaxed text-[#B0742E]">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>
              Couldn&apos;t read your chart of accounts: {cfg.fetchError}
              <br />
              Any mapping already saved is still shown below and still in force.
            </span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-[#0F1B3D]">
              Bank account
              <span className="ml-1.5 font-normal text-[#5E6B85]">where the wire actually lands</span>
            </label>
            <AccountSelect value={bankAccountId} onChange={setBankAccountId} accounts={bankLike} placeholder="Select a bank account…" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-[#0F1B3D]">
              Fee account
              <span className="ml-1.5 font-normal text-[#5E6B85]">the expense account gateway fees post to</span>
            </label>
            <AccountSelect value={feeAccountId} onChange={setFeeAccountId} accounts={all} placeholder="Select a fee account…" />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#D8E1F1] bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-[15px] font-semibold text-[#0F1B3D]">Clearing account per gateway</h3>
        <p className="mb-4 text-[13px] leading-relaxed text-[#5E6B85]">
          One per gateway — this is what makes a payout traceable to the specific gateway that held the money. A
          gateway with no clearing account mapped simply can&apos;t be posted; nothing is guessed.
        </p>

        <div className="space-y-2.5">
          {(cfg?.gateways ?? []).map((g) => {
            const missing = cfg?.readiness.find((r) => r.gateway === g)?.missing ?? [];
            const ok = missing.length === 0;
            return (
              <div key={g} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#D8E1F1] bg-[#F3F6FC] p-3">
                <span className="inline-flex min-w-[110px] items-center gap-2 text-[13px] font-medium text-[#0F1B3D]">
                  <i className="h-2.5 w-2.5 rounded-full" style={{ background: gatewayColor(g) }} />
                  {g}
                </span>
                <div className="min-w-[240px] flex-1">
                  <AccountSelect
                    value={clearing[g] ?? ""}
                    onChange={(v) => setClearing({ ...clearing, [g]: v })}
                    accounts={all}
                    placeholder={`Select ${g} clearing account…`}
                  />
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${
                    ok ? "bg-[#F0F5EF] text-[#4B7A54]" : "bg-[#EAF1FD] text-[#B0742E]"
                  }`}
                >
                  {ok ? <><Check size={12} /> Ready</> : <><AlertTriangle size={12} /> {missing.join(", ")}</>}
                </span>
              </div>
            );
          })}
        </div>

      </div>

      <div className="rounded-2xl border border-[#D8E1F1] bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-[15px] font-semibold text-[#0F1B3D]">Bank transaction categories</h3>
        <p className="mb-4 text-[13px] leading-relaxed text-[#5E6B85]">
          Used by the Bank Transactions tab — one income account for every credit with no gateway match, and one
          expense account per debit kind. Map these once and every future statement upload posts with zero manual
          entry.
        </p>

        <div className="mb-4">
          <label className="mb-1.5 block text-[12px] font-medium text-[#0F1B3D]">
            Default income account
            <span className="ml-1.5 font-normal text-[#5E6B85]">where every credit posts from</span>
          </label>
          <AccountSelect value={incomeAccountId} onChange={setIncomeAccountId} accounts={all} placeholder="Select an income account…" />
          {cfg?.incomeReadiness && cfg.incomeReadiness.length > 0 && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[#EAF1FD] px-2.5 py-1 text-[11.5px] font-medium text-[#B0742E]">
              <AlertTriangle size={12} /> {cfg.incomeReadiness.join(", ")}
            </span>
          )}
        </div>

        <div className="space-y-2.5">
          {(cfg?.bankLineKinds ?? []).map((k) => {
            const missing = cfg?.kindReadiness.find((r) => r.kind === k)?.missing ?? [];
            const ok = missing.length === 0;
            return (
              <div key={k} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#D8E1F1] bg-[#F3F6FC] p-3">
                <span className="inline-flex min-w-[110px] items-center text-[13px] font-medium capitalize text-[#0F1B3D]">
                  {k}
                </span>
                <div className="min-w-[240px] flex-1">
                  <AccountSelect
                    value={expenseByKind[k] ?? ""}
                    onChange={(v) => setExpenseByKind({ ...expenseByKind, [k]: v })}
                    accounts={all}
                    placeholder={`Select ${k} expense account…`}
                  />
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${
                    ok ? "bg-[#F0F5EF] text-[#4B7A54]" : "bg-[#EAF1FD] text-[#B0742E]"
                  }`}
                >
                  {ok ? <><Check size={12} /> Ready</> : <><AlertTriangle size={12} /> {missing.join(", ")}</>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-[#D8E1F1] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-[#0F1B3D] px-4 py-2.5 text-[13px] font-medium text-white hover:bg-[#1E3A8A] disabled:opacity-60"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save mapping
          </button>
          <span className="text-[12px] text-[#5E6B85]">
            Saved values take precedence over the ZOHO_* environment variables; a field left blank falls back to env
            rather than unmapping it.
          </span>
        </div>
      </div>
    </div>
  );
}
