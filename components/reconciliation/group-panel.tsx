"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { BankTxnLine, BankTxnPostingState } from "@/components/finance/reconciliation/bank-txn-row";
import { groupBankLines } from "@/lib/reconciliation/group-detector";
import {
  autoClassify, applyGroupTypeDefaults, applyTaxTreatmentDefaults,
  isReadyToPost, GROUP_LABEL,
  type ClassifierContext, type GroupClassification, type GroupType,
  type ProfitSharePayee, type TaxTreatment, type UAEEmirate,
} from "@/lib/reconciliation/group-classifier";
import { aed2 } from "@/components/finance/reconciliation/types";

type ZohoAccount = { account_id: string; account_name: string; account_number?: string; currency_code?: string };
type ZohoTax = { tax_id: string; tax_name: string; tax_percentage: number };
type ReferenceData = {
  expenseAccounts: ZohoAccount[];
  equityAccounts: ZohoAccount[];
  bankAccounts: ZohoAccount[];
  taxes: ZohoTax[];
};

const EMIRATES: { code: UAEEmirate; name: string }[] = [
  { code: "AB", name: "Abu Dhabi" }, { code: "DU", name: "Dubai" },
  { code: "SH", name: "Sharjah" }, { code: "AJ", name: "Ajman" },
  { code: "UAQ", name: "Umm Al Quwain" }, { code: "RAK", name: "Ras Al Khaimah" },
  { code: "FUJ", name: "Fujairah" },
];

const GROUP_TYPES: GroupType[] = [
  "unclassified", "vendor_expense", "profit_share", "owner_drawing",
  "inter_account", "intl_goods_rcm", "skip",
];

export function GroupClassificationPanel({
  lines, postings, onPosted, syncWithZoho,
}: {
  lines: BankTxnLine[];
  postings: Record<string, BankTxnPostingState>;
  onPosted: () => void;
  syncWithZoho?: () => Promise<void> | void;
}) {
  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [payees, setPayees] = useState<ProfitSharePayee[]>([]);
  const [loading, setLoading] = useState(true);
  const [classifications, setClassifications] = useState<Record<string, GroupClassification>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [posting, setPosting] = useState(false);

  const loadReference = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const [refJson, payeeJson] = await Promise.all([
        fetch(`/api/zoho/reference${refresh ? "?refresh=1" : ""}`).then(r => r.json()),
        fetch("/api/reconcile/profit-share-payees").then(r => r.json()),
      ]);
      if (refJson.error) throw new Error(refJson.error);
      setReference(refJson);
      setPayees((payeeJson.payees ?? []).map((p: any) => ({
        normalizedName: p.normalized_name,
        displayName: p.display_name,
        equityAccountId: p.equity_account_id,
      })));
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadReference(); }, [loadReference]);

  // Best-effort defaults for the classifier. User overrides per row.
  const ctx: ClassifierContext | null = useMemo(() => {
    if (!reference) return null;
    const sib = reference.bankAccounts.find(b =>
      /sharjah\s*islamic/i.test(b.account_name) || b.account_number === "12043598001",
    );
    const vat5 = reference.taxes.find(t => t.tax_percentage === 5 && /standard/i.test(t.tax_name));
    const ownerDrawings = reference.equityAccounts.find(a => /owner.*draw|drawings/i.test(a.account_name));
    return {
      defaultBankAccountId: sib?.account_id ?? "",
      standardVat5Id: vat5?.tax_id ?? "",
      ownerDrawingsAccountId: ownerDrawings?.account_id ?? "",
      defaultPlaceOfSupply: "DU",
      payees,
    };
  }, [reference, payees]);

  // Exclude lines that were already posted (via any endpoint) so refresh doesn't
  // resurrect them.
  const groups = useMemo(() => {
    if (!ctx) return [];
    return groupBankLines(lines.filter(l => postings[l.id]?.status !== "posted"));
  }, [lines, postings, ctx]);

  // Seed classifications for newly seen groups; drop them for groups that vanished.
  useEffect(() => {
    if (!ctx) return;
    setClassifications(prev => {
      const next = { ...prev };
      for (const g of groups) if (!next[g.key]) next[g.key] = autoClassify(g, ctx);
      for (const k of Object.keys(next)) if (!groups.find(g => g.key === k)) delete next[k];
      return next;
    });
  }, [groups, ctx]);

  const filtered = useMemo(() => {
    if (!query.trim()) return groups;
    const q = query.toLowerCase();
    return groups.filter(g =>
      g.reference.toLowerCase().includes(q) ||
      g.payee.toLowerCase().includes(q) ||
      g.mainLine.description.toLowerCase().includes(q) ||
      String(Math.abs(g.mainLine.amount)).includes(q),
    );
  }, [groups, query]);

  const readyKeys = useMemo(
    () => filtered.filter(g => {
      const c = classifications[g.key];
      return c && isReadyToPost(c);
    }).map(g => g.key),
    [filtered, classifications],
  );

  const selectedReady = readyKeys.filter(k => selected.has(k));
  const bulkKeys = selectedReady.length ? selectedReady : readyKeys;
  const allReady = readyKeys.length > 0 && readyKeys.every(k => selected.has(k));

  const patch = (key: string, updater: Partial<GroupClassification> | ((c: GroupClassification) => GroupClassification)) => {
    setClassifications(prev => {
      const cur = prev[key]; if (!cur) return prev;
      const next = typeof updater === "function" ? updater(cur) : { ...cur, ...updater };
      return { ...prev, [key]: next };
    });
  };

  const postGroups = async (keys: string[]) => {
    if (!keys.length || !ctx) return;
    setPosting(true);
    try {
      const payload = {
        groups: keys.map(k => {
          const g = groups.find(x => x.key === k)!;
          const c = classifications[k];
          return {
            groupKey: k,
            mainBankLineId: g.mainLine.id,
            reference: g.reference,
            date: g.date,
            amount: Math.abs(g.mainLine.amount),
            description: g.mainLine.description,
            payee: g.payee,
            groupType: c.groupType,
            paidThroughAccountId: c.paidThroughAccountId,
            placeOfSupply: c.placeOfSupply,
            expenseAccountId: c.expenseAccountId,
            taxTreatment: c.taxTreatment,
            taxId: c.taxId,
            isInclusiveTax: c.isInclusiveTax,
            isReverseChargeApplied: c.isReverseChargeApplied,
            destinationAccountId: c.destinationAccountId,
          };
        }),
      };
      const res = await fetch("/api/reconcile/groups/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const ok = (json.results ?? []).filter((r: any) => r.status === "posted").length;
      const failed = (json.results ?? []).length - ok;
      if (ok) toast.success(`Posted ${ok} group${ok === 1 ? "" : "s"} to Zoho`);
      if (failed) {
        const first = (json.results ?? []).find((r: any) => r.status === "failed");
        toast.error(`${failed} failed — first: ${first?.error ?? "unknown"}`);
      }
      setSelected(new Set());
      onPosted();
      // Non-fatal — a sync failure shouldn't hide the post success toast.
      if (ok && syncWithZoho) { try { await syncWithZoho(); } catch { /* noop */ } }
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setPosting(false); }
  };

  const savePayee = async (rawName: string, equityAccountId: string) => {
    try {
      const res = await fetch("/api/reconcile/profit-share-payees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          normalizedName: rawName.toLowerCase().trim(),
          displayName: rawName,
          equityAccountId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await loadReference();
      toast.success(`Payee saved · ${rawName}`);
    } catch (e) { toast.error((e as Error).message); }
  };

  if (loading) return (
    <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#EAE3D6] bg-[#FBF8F1] p-3 text-[13px] text-[#8A8175]">
      <Loader2 size={14} className="animate-spin" /> Loading Zoho reference data…
    </div>
  );

  if (!ctx || !reference || !groups.length) return null;

  return (
    <div className="mb-3 rounded-xl border border-[#EAE3D6] bg-[#FBF8F1] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#1F1B16]">
          <Sparkles size={14} className="text-[#B08343]" />
          Debit groups — {groups.length} economic event{groups.length === 1 ? "" : "s"}
          <span className="text-[11px] text-[#8A8175]">
            ({readyKeys.length} ready · {groups.length - readyKeys.length} need setup)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => loadReference(true)} title="Refresh Zoho reference data"
            className="rounded-full border border-[#D6CCBA] bg-white px-2.5 py-1.5 text-[12px] text-[#1F1B16] hover:bg-[#F3EFE7]">
            <RefreshCw size={12} />
          </button>
          {readyKeys.length > 0 && (
            <button
              onClick={() => setSelected(allReady ? new Set() : new Set(readyKeys))}
              className="rounded-full border border-[#D6CCBA] bg-white px-3 py-1.5 text-[12px] text-[#1F1B16] hover:bg-[#F3EFE7]">
              {allReady ? "Deselect all" : `Select ready (${readyKeys.length})`}
            </button>
          )}
          <button onClick={() => postGroups(bulkKeys)} disabled={posting || !bulkKeys.length}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#B08343] px-4 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">
            {posting && <Loader2 size={13} className="animate-spin" />}
            {selectedReady.length ? `Post ${selectedReady.length} selected` : `Post all ready (${readyKeys.length})`}
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-full border border-[#D6CCBA] bg-white px-3 py-1.5 text-[12px]">
        <Search size={13} className="text-[#8A8175]" />
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search reference, payee, description, amount…"
          className="w-full bg-transparent outline-none placeholder:text-[#B8AE9C]" />
        {query && <button onClick={() => setQuery("")} className="text-[11px] text-[#8A8175] hover:text-[#1F1B16]">clear</button>}
      </div>

      <div className="space-y-2">
        {filtered.map(g => {
          const c = classifications[g.key]; if (!c) return null;
          const ready = isReadyToPost(c);
          const isExpense = c.groupType === "vendor_expense" || c.groupType === "intl_goods_rcm";
          const isTransfer = c.groupType === "profit_share" || c.groupType === "owner_drawing" || c.groupType === "inter_account";
          const canOfferPayeeSave = c.groupType === "profit_share" && g.payee &&
            !payees.some(p => g.payee.toLowerCase().includes(p.normalizedName)) &&
            c.destinationAccountId;

          return (
            <div key={g.key} className="rounded-lg border border-[#EAE3D6] bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-[#F3EFE7] px-3 py-2 text-[12px]">
                <input type="checkbox" className="h-3.5 w-3.5"
                  checked={selected.has(g.key)} disabled={!ready}
                  onChange={() => setSelected(s => {
                    const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n;
                  })} />
                <span className="text-[#8A8175]">{(g.date || "").slice(0, 10)}</span>
                <span className="font-mono text-[#1F1B16]">{g.reference}</span>
                <span className="text-[#1F1B16]">→ {g.payee || <em className="text-[#8A8175]">(unknown payee)</em>}</span>
                {g.feeLines.length > 0 && (
                  <span className="rounded-full bg-[#F3EFE7] px-2 py-0.5 text-[11px] text-[#8A8175]">
                    +{g.feeLines.length} fee line{g.feeLines.length === 1 ? "" : "s"} — Bank Charges panel
                  </span>
                )}
                {c.autoClassified && (
                  <span className="rounded-full bg-[#F0F5EF] px-2 py-0.5 text-[11px] text-[#4B7A54]" title={c.reasons.join(" · ")}>auto</span>
                )}
                <span className="ml-auto font-medium text-[#1F1B16]">{aed2(Math.abs(g.mainLine.amount))}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${ready ? "bg-[#F0F5EF] text-[#4B7A54]" : "bg-[#FBF3E6] text-[#6F5325]"}`}>
                  {ready ? "Ready" : c.groupType === "unclassified" ? "Pick type" : "Fill fields"}
                </span>
              </div>

              <div className="grid gap-2 px-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Type">
                  <select value={c.groupType}
                    onChange={e => patch(g.key, cur => applyGroupTypeDefaults(cur, e.target.value as GroupType, ctx))}
                    className="w-full rounded border border-[#D6CCBA] bg-white px-2 py-1 text-[12px]">
                    {GROUP_TYPES.map(t => <option key={t} value={t}>{GROUP_LABEL[t]}</option>)}
                  </select>
                </Field>

                <Field label="Paid Through">
                  <select value={c.paidThroughAccountId ?? ""}
                    onChange={e => patch(g.key, { paidThroughAccountId: e.target.value })}
                    className="w-full rounded border border-[#D6CCBA] bg-white px-2 py-1 text-[12px]">
                    <option value="">— pick —</option>
                    {reference.bankAccounts.map(a => (
                      <option key={a.account_id} value={a.account_id}>
                        [{a.account_name}] {a.account_number ?? ""}
                      </option>
                    ))}
                  </select>
                </Field>

                {isExpense && (
                  <>
                    <Field label="Expense Account">
                      <select value={c.expenseAccountId ?? ""}
                        onChange={e => patch(g.key, { expenseAccountId: e.target.value })}
                        className="w-full rounded border border-[#D6CCBA] bg-white px-2 py-1 text-[12px]">
                        <option value="">— pick —</option>
                        {reference.expenseAccounts.map(a => (
                          <option key={a.account_id} value={a.account_id}>{a.account_name}</option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Tax Treatment">
                      <select value={c.taxTreatment ?? ""}
                        onChange={e => patch(g.key, cur => applyTaxTreatmentDefaults(cur, e.target.value as TaxTreatment, ctx))}
                        className="w-full rounded border border-[#D6CCBA] bg-white px-2 py-1 text-[12px]">
                        <option value="">— pick —</option>
                        <option value="vat_registered">VAT Registered</option>
                        <option value="non_registered">Non VAT Registered</option>
                        <option value="non_gcc">Non GCC (RCM)</option>
                      </select>
                    </Field>

                    <Field label="Tax">
                      <select value={c.taxId ?? ""}
                        onChange={e => patch(g.key, { taxId: e.target.value || undefined, isInclusiveTax: Boolean(e.target.value) })}
                        disabled={c.taxTreatment === "non_registered"}
                        className="w-full rounded border border-[#D6CCBA] bg-white px-2 py-1 text-[12px] disabled:opacity-50">

                        <>
                        {c.taxTreatment === "vat_registered"&&(
                          <option key={1} value={""}>Standard Rate 5%</option>  
                        )}
                        {reference.taxes.map(t => (
                          <option key={t.tax_id} value={t.tax_id}>{t.tax_name} [{t.tax_percentage}%]</option>
                        ))}
                        </>
                      </select>
                    </Field>

                    <Field label="Place of Supply">
                      <select value={c.placeOfSupply ?? ""}
                        onChange={e => patch(g.key, { placeOfSupply: (e.target.value || undefined) as UAEEmirate | undefined })}
                        className="w-full rounded border border-[#D6CCBA] bg-white px-2 py-1 text-[12px]">
                        <option value="">— pick —</option>
                        {EMIRATES.map(e => <option key={e.code} value={e.code}>{e.name}</option>)}
                      </select>
                    </Field>

                    <Field label="Amount is">
                      <div className="flex items-center gap-3 text-[11px] text-[#8A8175]">
                        <label className="inline-flex items-center gap-1">
                          <input type="radio" checked={c.isInclusiveTax === true} 
                            onChange={() => patch(g.key, { isInclusiveTax: true })} />
                          Tax inclusive
                        </label>
                        <label className="inline-flex items-center gap-1">
                          <input type="radio" checked={c.isInclusiveTax === false} 
                            onChange={() => patch(g.key, { isInclusiveTax: false })} />
                          Tax exclusive
                        </label>
                        {c.groupType === "intl_goods_rcm" && (
                          <label className="ml-auto inline-flex items-center gap-1">
                            <input type="checkbox" checked={c.isReverseChargeApplied ?? false}
                              onChange={e => patch(g.key, { isReverseChargeApplied: e.target.checked })} />
                            RCM
                          </label>
                        )}
                      </div>
                    </Field>
                  </>
                )}

                {isTransfer && (
                  <Field label={c.groupType === "profit_share" ? "Payee equity account"
                              : c.groupType === "owner_drawing" ? "Owner drawings account" : "To bank account"}>
                    <select value={c.destinationAccountId ?? ""}
                      onChange={e => patch(g.key, { destinationAccountId: e.target.value })}
                      className="w-full rounded border border-[#D6CCBA] bg-white px-2 py-1 text-[12px]">
                      <option value="">— pick —</option>
                      {(c.groupType === "inter_account" ? reference.bankAccounts : reference.equityAccounts).map(a => (
                        <option key={a.account_id} value={a.account_id}>{a.account_name}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-[#F3EFE7] px-3 py-2 text-[11px]">
                {c.reasons.length > 0 && <span className="text-[#8A8175]">{c.reasons.join(" · ")}</span>}
                {canOfferPayeeSave && (
                  <button onClick={() => savePayee(g.payee, c.destinationAccountId!)}
                    className="rounded-full border border-[#D6CCBA] bg-white px-2 py-0.5 text-[11px] text-[#1F1B16] hover:bg-[#F3EFE7]"
                    title="Save this payee → equity account mapping. Future transfers to them auto-classify.">
                    Remember {g.payee} → this account
                  </button>
                )}
                <button onClick={() => postGroups([g.key])} disabled={!ready || posting}
                  className="ml-auto rounded-full border border-[#D6CCBA] bg-white px-2.5 py-0.5 text-[11px] text-[#1F1B16] hover:bg-[#F3EFE7] disabled:opacity-40">
                  Post
                </button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="rounded-lg border border-dashed border-[#D6CCBA] bg-white p-4 text-center text-[12px] text-[#8A8175]">
            No groups match “{query}”. {groups.length} loaded — clear the search.
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-[#8A8175]">{label}</span>
      {children}
    </label>
  );
}