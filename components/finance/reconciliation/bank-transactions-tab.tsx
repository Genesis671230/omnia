"use client";
import { GroupClassificationPanel } from "@/components/reconciliation/group-panel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { isInZoho } from "@/lib/reconciliation/bank-line-zoho-status";
import { toast } from "sonner";
import { matchesBankTxnQuery, matchesPostStatus, type PostStatusFilter } from "@/lib/reconciliation/bank-line-filters";
import { BankTxnFilters, type Direction, type PostStatusFilterValue } from "./bank-txn-filters";
import { BankTxnRow, type BankTxnLine, type BankTxnPostingState } from "./bank-txn-row";
import { BankTxnPostDialog } from "./bank-txn-post-dialog";
import { SupplierPaymentDialog } from "./supplier-payment-dialog";
import { ZohoEntryDeleteDialog } from "./zoho-entry-delete-dialog";
import { resolveDraftPosting, normalizeAccountMap, type DraftPosting } from "@/lib/reconciliation/mapping-resolver";
import { defaultBankLineNote, zohoDescriptionFor } from "@/lib/reconciliation/bank-line-description";
import type { ZohoAccountMap } from "@/lib/integrations/zoho-banking";
import { AccountCombobox } from "./account-combobox";
import { BankTxnTable } from "./bank-txn-table";
import { BankChargesPanel } from "../../reconciliation/bank-charges-panel";
import type { BankChargeSettings } from "@/lib/reconciliation/bank-charge-detector";
import type { StatementAccount } from "@/lib/finance/statement-accounts";
import { StatementAccountBar, type ZohoOrgOption } from "./statement-account-bar";

const LEGACY_ACCOUNT = "sib-omniastores";
const SIB_ZOHO_ACCOUNT = "2330082000000236001";
const ACCOUNT_KEY = "omnia.bankTab.statementAccount";
export type ZohoAccount = { account_id: string; account_name: string; account_type: string };

export function BankTransactionsTab({
  fromDate, toDate, onRange, zohoSettings, zohoAccounts: mainZohoAccounts,
}: {
  fromDate: string; toDate: string; onRange: (from: string, to: string) => void;
  zohoSettings: Partial<ZohoAccountMap> | undefined; zohoAccounts: ZohoAccount[];
}) {
  // Which statement this tab shows: SIB, RAK, a card… each in its own books.
  const [stmtAccounts, setStmtAccounts] = useState<StatementAccount[]>([]);
  const [orgs, setOrgs] = useState<ZohoOrgOption[]>([]);
  const [accountId, setAccountIdState] = useState<string>(() => {
    try { return localStorage.getItem(ACCOUNT_KEY) || LEGACY_ACCOUNT; } catch { return LEGACY_ACCOUNT; }
  });
  const setAccountId = (id: string) => {
    setAccountIdState(id);
    setSelected(new Set());
    try { localStorage.setItem(ACCOUNT_KEY, id); } catch { /* per-viewer convenience only */ }
  };
  const loadStmtAccounts = useCallback(async () => {
    try {
      const j = await fetch("/api/statement-accounts").then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setStmtAccounts(j.accounts);
      setOrgs(j.orgs);
    } catch (e) {
      toast.error(`Statement accounts: ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => { loadStmtAccounts(); }, [loadStmtAccounts]);
  const account = stmtAccounts.find((a) => a.id === accountId);
  const isMainOrg = !account || !account.zohoConnectionId || account.zohoConnectionId === "env";
  const isLegacy = accountId === LEGACY_ACCOUNT;

  // A non-main account (RAK → House of Omnia) posts against its own org's chart.
  const [orgAccounts, setOrgAccounts] = useState<ZohoAccount[]>([]);
  useEffect(() => {
    if (isMainOrg || !account) { setOrgAccounts([]); return; }
    let live = true;
    fetch(`/api/integrations/zoho/account-config?zohoOrg=${encodeURIComponent(account.zohoConnectionId)}`)
      .then((r) => r.json())
      .then((j) => { if (live) { if (j.error) toast.error(`${account.label}: ${j.error}`); setOrgAccounts(j.allAccounts ?? []); } })
      .catch((e) => live && toast.error((e as Error).message));
    return () => { live = false; };
  }, [isMainOrg, account]);
  const zohoAccounts = isMainOrg ? mainZohoAccounts : orgAccounts;
  // The Zoho bank / card account this statement IS.
  const bankZohoId = account?.zohoAccountId || (isLegacy ? SIB_ZOHO_ACCOUNT : "");

  const baseSettings = normalizeAccountMap(zohoSettings);
  // Clearing / fee / income ids are Omniastores' chart — meaningless in another org's books.
  const settings = useMemo(() => isMainOrg
    ? { ...baseSettings, bankAccountId: bankZohoId }
    : { bankAccountId: bankZohoId, feeAccountId: "", clearingByGateway: {}, defaultIncomeAccountId: "", expenseAccountByKind: {} },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(baseSettings), bankZohoId, isMainOrg]);
  // Bank-charges settings are on the same config blob but not yet in ZohoAccountMap.
// Cast until you add these two fields to /api/integrations/zoho/account-config's
// response type: bankChargesAccountId (Bank Fees and Charges) + vatStandard5Id (VAT 5%).
const chargeSettings: BankChargeSettings = {
  bankAccountId: bankZohoId,
  bankChargesAccountId: (settings as any).bankChargesAccountId ?? "2330082000000000409",
  vatStandard5Id: (settings as any).vatStandard5Id ?? "",
  placeOfSupply: (settings as any).placeOfSupply ?? "DU",
};
  const [lines, setLines] = useState<BankTxnLine[]>([]);
  const [postings, setPostings] = useState<Record<string, BankTxnPostingState>>({});
  const [loading, setLoading] = useState(true);
  const [zohoError, setZohoError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<Direction>("all");
  const [postStatus, setPostStatus] = useState<PostStatusFilterValue>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [supplierLine, setSupplierLine] = useState<BankTxnLine | null>(null);
  const [zohoEdit, setZohoEdit] = useState<{ line: BankTxnLine; mode: "delete" | "edit" } | null>(null);

  const [syncing, setSyncing] = useState(false);
const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Sticky defaults: set once, apply automatically to every draft that
  // doesn't already have a real gateway match — not a one-off bulk-apply
  // to whatever's checked right now. From-account defaults to Omnia
  // Stores LLC's own bank account as soon as settings load.
  const [defaultFromAccountId, setDefaultFromAccountId] = useState(settings.bankAccountId || "");
  const [defaultToAccountId, setDefaultToAccountId] = useState("");



// The only Zoho call this tab makes. Page loads read the stored status;
// this re-reads the Zoho ledger for the visible range (≈1 API call per 200
// Zoho transactions) so edits made in Zoho show up — nothing else polls.
const syncWithZoho = async (force = false) => {
  if (!fromDate || !toDate) { toast.error("Pick a From and To date first"); return; }
  setSyncing(true);
  try {
    const res = await fetch("/api/reconcile/bank-lines/zoho-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromDate, to: toDate, account: accountId, force }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    if (json.cached) {
      toast.message("Checked Zoho under 30s ago — showing that result. Wait a moment to refresh again.");
    } else {
      toast.success(
        `Zoho checked: ${json.inZoho} in Zoho, ${json.notFound} not in Zoho` +
        `${json.amountDiffers ? `, ${json.amountDiffers} amount differs` : ""}` +
        `${json.uncategorized ? `, ${json.uncategorized} unbooked in feed` : ""}` +
        ` · ${json.zohoCalls} API call${json.zohoCalls === 1 ? "" : "s"}${json.quota ? ` (${json.quota.used}/${json.quota.budget} today)` : ""}`,
      );
    }
    await load();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    setSyncing(false);
  }
};

  // Switching statement resets the fallback from-account to that statement's own account.
  useEffect(() => {
    setDefaultFromAccountId(settings.bankAccountId || "");
    setDefaultToAccountId("");
  }, [settings.bankAccountId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      params.set("account", accountId);
      const r = await fetch(`/api/reconcile/bank-lines?${params}`).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setLines(r.lines);
      setPostings(r.postings);
      setZohoError(r.zohoError ?? null);
      setLastSyncedAt(r.zohoCheckedAt ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
    // The Zoho account config (and settings.bankAccountId with it) loads
    // asynchronously after this component mounts — without it in the deps,
    // this closure keeps the empty bankAccountId from the first render
    // forever, and /api/reconcile/bank-lines now 400s without an accountId.
  }, [fromDate, toDate, accountId]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () => lines
      .filter((l) => direction === "all" || l.direction === direction)
      .filter((l) => matchesBankTxnQuery(l, query, postings[l.id]))
      .filter((l) => matchesPostStatus(l.id, postings, postStatus as PostStatusFilter)),
    [lines, direction, query, postings, postStatus],
  );

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const onDescriptionSaved = (id: string, zohoDescription: string) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, zohoDescription } : l)));
  };

  const draftsByLineId = useMemo(() => {
    const map = new Map<string, DraftPosting>();
    for (const line of lines) {
      // Classify on the bank's own narration, never on the note a person
      // added — the note can say anything and must not move a line's gateway.
      let draft = resolveDraftPosting(
        {
          id: line.id,
          date: line.date ?? null,
          narration: line.description,
          reference: line.reference ?? null,
          amount: line.direction === "debit" ? -Math.abs(line.amount) : Math.abs(line.amount),
        },
        settings,
      );
      const defaultNote = defaultBankLineNote({
        direction: line.direction, amount: line.amount, date: line.date, narration: line.description,
        reference: line.reference, entity: draft.intent.entity ?? line.gatewayGuess, kind: draft.intent.kind, payout: line.payout ?? null,
      });
      const note = line.zohoDescription || defaultNote;
      draft = { ...draft, direction: line.direction, bankNarration: line.description, note, defaultNote, description: zohoDescriptionFor(note, line.description) };

      // Fill gaps with the sticky default — never overwrite a real gateway match.
      const usedFromDefault = !draft.fromAccountId && Boolean(defaultFromAccountId);
      const usedToDefault = !draft.toAccountId && Boolean(defaultToAccountId);
      if (usedFromDefault || usedToDefault) {
        draft = {
          ...draft,
          fromAccountId: (draft.fromAccountId ?? defaultFromAccountId) || undefined,
          toAccountId: (draft.toAccountId ?? defaultToAccountId) || undefined,
          reasons: [
            ...draft.reasons,
            ...(usedFromDefault ? ["using default from-account"] : []),
            ...(usedToDefault ? ["using default to-account"] : []),
          ],
        };
        if (draft.fromAccountId && draft.toAccountId) draft = { ...draft, confidence: "ready" };
      }

      map.set(line.id, draft);
    }
    return map;
  }, [lines, settings, defaultFromAccountId, defaultToAccountId]);

  // Lines already in Zoho never reach the post dialog — the server refuses
  // them too, this just keeps them out of the review list.
  const selectedDrafts = useMemo(
    () => Array.from(selected)
      .filter((id) => postings[id]?.status !== "verified")
      .map((id) => draftsByLineId.get(id)).filter((d): d is DraftPosting => Boolean(d)),
    [selected, draftsByLineId, postings],
  );
  const selectedInZoho = Array.from(selected).filter((id) => postings[id]?.status === "verified").length;

  const readyIds = useMemo(
    () => visible
      .filter((l) => draftsByLineId.get(l.id)?.confidence === "ready" && !isInZoho(postings[l.id]?.status))
      .map((l) => l.id),
    [visible, draftsByLineId, postings],
  );
  const allReadySelected = readyIds.length > 0 && readyIds.every((id) => selected.has(id));
  const toggleSelectAllReady = () => setSelected(allReadySelected ? new Set() : new Set(readyIds));
  const selectAllReady = () => setSelected(new Set(readyIds));
const deSelectAll = ()=>setSelected(new Set())
  return (
    <>
      <StatementAccountBar accounts={stmtAccounts} orgs={orgs} selectedId={accountId} onSelect={setAccountId}
        zohoAccounts={zohoAccounts} onSaved={loadStmtAccounts} />
      {account && !bankZohoId && (
        <div className="mb-3 rounded-lg border border-[#E8C9BE] bg-[#F9ECE7] px-3 py-2 text-[12.5px] text-[#A6472F]">
          Pick which Zoho {account.kind === "credit_card" ? "credit card" : "bank"} account {account.label} is (the settings link above) — until then its lines can be read but not posted.
        </div>
      )}
      <BankTxnFilters query={query} onQuery={setQuery} direction={direction} onDirection={setDirection}
        postStatus={postStatus} onPostStatus={setPostStatus} fromDate={fromDate} toDate={toDate}
        onRange={onRange} resultCount={visible.length} totalCount={lines.length} />

<div className="mb-3 flex flex-wrap items-center gap-3">
  <button onClick={() => syncWithZoho()} disabled={syncing}
    title="Re-read the Zoho Books ledger for this date range. Page loads never call Zoho."
    className="inline-flex items-center gap-1.5 rounded-full border border-[#C9D5EA] bg-white px-3 py-1.5 text-[12px] text-[#0F1B3D] disabled:opacity-50">
    <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
    {syncing ? "Checking Zoho…" : "Refresh Zoho status"}
  </button>
  <span className="text-[11px] text-[#5E6B85]">
    {lastSyncedAt
      ? `Zoho status as of ${new Date(lastSyncedAt).toLocaleString()} — edits made in Zoho show after the next refresh`
      : "Zoho status not checked for this range yet — press Refresh"}
  </span>
</div>
{zohoError && (
  <div className="my-2 rounded-lg border border-[#E8C9BE] bg-[#F9ECE7] px-3 py-2 text-[12.5px] text-[#A6472F]">
    Bank lines loaded, but Zoho could not be checked, so the Zoho status column is blank: {zohoError}
  </div>
)}
{/* These two post through routes that only know Omniastores' books — SIB only. */}
{isLegacy && (
  <>
    <GroupClassificationPanel lines={lines} postings={postings} onPosted={load} />
    <BankChargesPanel lines={lines} postings={postings} onPosted={load} />
  </>
)}


   <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-[#D8E1F1] bg-[#F3F6FC] p-3">
        <div className="w-56">
          <div className="mb-1 text-[11px] text-[#5E6B85]">Default from-account (fallback)</div>
          <AccountCombobox accounts={zohoAccounts} value={defaultFromAccountId}
            defaultAccountId={settings.bankAccountId} placeholder="None set"
            onChange={setDefaultFromAccountId} />
        </div>
        <div className="w-56">
          <div className="mb-1 text-[11px] text-[#5E6B85]">Default to-account (fallback)</div>
          <AccountCombobox accounts={zohoAccounts} value={defaultToAccountId}
            defaultAccountId={settings.bankAccountId} placeholder="None set"
            onChange={setDefaultToAccountId} />
        </div>
        <div className="text-[11px] text-[#5E6B85]">
          Applied only when a line has no real gateway match — matched lines always keep their own mapping.
        </div>
      </div>

      {readyIds.length > 0 && (
  <button onClick={toggleSelectAllReady} className="mb-3 rounded-full border border-[#C9D5EA] bg-white px-3 py-1.5 text-[12px] text-[#0F1B3D]">
    {allReadySelected ? "Deselect all" : `Select all ready (${readyIds.length})`}
  </button>
)}

      {loading ? (
        <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-dashed border-[#C9D5EA] bg-white p-10 text-[14px] text-[#5E6B85]">
          <Loader2 size={18} className="animate-spin" /> Loading bank transactions…
        </div>
      ) : lines.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#C9D5EA] bg-white p-10 text-center text-[14px] leading-relaxed text-[#5E6B85]">
          No lines for {account?.label ?? "this account"} in this range. Upload its statement (PDF, CSV, or XLS/XLSX) above and pick this account.
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#C9D5EA] bg-white p-10 text-center text-[14px] leading-relaxed text-[#5E6B85]">
          No lines match the current filters. {lines.length} line{lines.length === 1 ? " is" : "s are"} loaded.
        </div>
      ) : (
        // <div className="space-y-2 pb-16">
        //   {visible.map((l) => (
        //     <BankTxnRow key={l.id} line={l} posting={postings[l.id]} draft={draftsByLineId.get(l.id)}
        //       selected={selected.has(l.id)} onToggleSelect={toggleSelect} onDescriptionSaved={onDescriptionSaved} />
        //   ))}
        // </div>
            <BankTxnTable
              lines={visible}
              postings={postings}
              draftsByLineId={draftsByLineId}
              selected={selected}
              onToggleSelect={toggleSelect}
              onDescriptionSaved={onDescriptionSaved}
              onPaySupplier={setSupplierLine}
              onPostOne={(l) => { setSelected(new Set([l.id])); setDialogOpen(true); }}
              onEditZoho={(l) => setZohoEdit({ line: l, mode: "edit" })}
              onDeleteZoho={(l) => setZohoEdit({ line: l, mode: "delete" })}
            />
      )}
     
      {selected.size > 0 && (
        <div className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#C9D5EA] bg-white px-5 py-3 shadow-lg">
          <span className="text-[13px] text-[#0F1B3D]">
            {selected.size} selected{selectedInZoho ? ` · ${selectedInZoho} already in Zoho, skipped` : ""}
          </span>
          <button onClick={() => setDialogOpen(true)} disabled={selectedDrafts.length === 0}
            className="rounded-full bg-[#0F1B3D] px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">
            Post {selectedDrafts.length} to Zoho
          </button>
          <button onClick={deSelectAll} className="text-[12px] text-[#5E6B85] underline">Clear</button>
        </div>
      )}

      {zohoEdit && (
        <ZohoEntryDeleteDialog
          line={zohoEdit.line}
          mode={zohoEdit.mode}
          onClose={() => setZohoEdit(null)}
          onDeleted={async () => {
            const { line, mode } = zohoEdit;
            setZohoEdit(null);
            await load();
            // Edit = delete, then the same line straight back into the posting form.
            if (mode === "edit") { setSelected(new Set([line.id])); setDialogOpen(true); }
          }}
        />
      )}

      {supplierLine && (
        <SupplierPaymentDialog
          line={supplierLine}
          bankAccountId={chargeSettings.bankAccountId}
          accounts={zohoAccounts}
          onClose={() => setSupplierLine(null)}
          onBooked={() => load()}
        />
      )}

      {dialogOpen && (
        <BankTxnPostDialog
          drafts={selectedDrafts}
          settings={settings}
          accounts={zohoAccounts}
          onClose={() => setDialogOpen(false)}
          onPosted={() => { setSelected(new Set()); load(); }}
          onDescriptionSaved={onDescriptionSaved}
          onPaySupplier={(id) => {
            const l = lines.find((x) => x.id === id);
            if (l) { setDialogOpen(false); setSupplierLine(l); }
          }}
        />
      )}
    </>
  );
}