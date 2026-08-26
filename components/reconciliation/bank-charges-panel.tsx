"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  detectBankChargeDrafts,
  type BankChargeDraft,
} from "@/lib/reconciliation/bank-charge-detector";
import type { BankTxnLine, BankTxnPostingState } from "@/components/finance/reconciliation/bank-txn-row";
import { aed2 } from "@/components/finance/reconciliation/types";

type UAEEmirate = "AB" | "DU" | "SH" | "AJ" | "UAQ" | "RAK" | "FUJ";
type TaxTreatment = "vat_registered" | "non_registered";

type ZohoAccount = { account_id: string; account_name: string; account_number?: string };
type ZohoTax = { tax_id: string; tax_name: string; tax_percentage: number };
type ReferenceData = {
  expenseAccounts: ZohoAccount[];
  bankAccounts: ZohoAccount[];
  taxes: ZohoTax[];
};

const EMIRATES: { code: UAEEmirate; name: string }[] = [
  { code: "AB", name: "Abu Dhabi" }, { code: "DU", name: "Dubai" },
  { code: "SH", name: "Sharjah" }, { code: "AJ", name: "Ajman" },
  { code: "UAQ", name: "Umm Al Quwain" }, { code: "RAK", name: "Ras Al Khaimah" },
  { code: "FUJ", name: "Fujairah" },
];

// The bar's config. This drives every selected row on Post — no per-row overrides,
// no stored settings blob. One human, one decision, applies to many.
type Config = {
  taxTreatment: TaxTreatment;
  paidThroughAccountId: string;
  expenseAccountId: string;
  placeOfSupply: UAEEmirate;
  taxId: string; // used only when taxTreatment === "vat_registered"
};

export function BankChargesPanel({
  lines, postings, onPosted,
}: {
  lines: BankTxnLine[];
  postings: Record<string, BankTxnPostingState>;
  onPosted: () => void;
}) {
  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [loadingRef, setLoadingRef] = useState(true);

  const [config, setConfig] = useState<Config>({
    taxTreatment: "vat_registered",
    paidThroughAccountId: "",
    expenseAccountId: "",
    placeOfSupply: "DU",
    taxId: "",
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState(false);
  const [rowPosting, setRowPosting] = useState<Set<string>>(new Set());

  const loadReference = useCallback(async (refresh = false) => {
    setLoadingRef(true);
    try {
      const res = await fetch(`/api/zoho/reference${refresh ? "?refresh=1" : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setReference(json);

      // First-load defaults — best-effort guesses. User can change anything.
      setConfig((prev) => {
        const next = { ...prev };
        if (!next.paidThroughAccountId) {
          const sib = json.bankAccounts.find(
            (b: ZohoAccount) =>
              /sharjah\s*islamic/i.test(b.account_name) ||
              b.account_number === "12043598001",
          );
          if (sib) next.paidThroughAccountId = sib.account_id;
        }
        if (!next.expenseAccountId) {
          const bankFees = json.expenseAccounts.find((a: ZohoAccount) =>
            /bank\s*(fees?|charges?)/i.test(a.account_name),
          );
          if (bankFees) next.expenseAccountId = bankFees.account_id;
        }
        if (!next.taxId) {
          const vat5 = json.taxes.find(
            (t: ZohoTax) => t.tax_percentage === 5 && /standard/i.test(t.tax_name),
          );
          if (vat5) next.taxId = vat5.tax_id;
        }
        return next;
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingRef(false);
    }
  }, []);

  useEffect(() => { loadReference(); }, [loadReference]);

  // Detector still runs (it's the thing that pairs 0.48+0.02 → one 0.50 expense,
  // and lifts SWIFT-style standalones). But its settings block is passed empty —
  // we ignore its "ready/needs mapping" output entirely. The bar is the source of truth.
  const drafts = useMemo(() => {
    const active = lines.filter((l) => postings[l.id]?.status !== "posted");
    const raw = detectBankChargeDrafts(active, {
      bankAccountId: "",
      bankChargesAccountId: "",
      vatStandard5Id: "",
      placeOfSupply: "DU",
    });
    return raw.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [lines, postings]);

  const keyOf = (d: BankChargeDraft) => d.bankLineIds.join("-");

  const configComplete =
    Boolean(config.paidThroughAccountId) &&
    Boolean(config.expenseAccountId) &&
    Boolean(config.placeOfSupply) &&
    (config.taxTreatment === "non_registered" || Boolean(config.taxId));

  const post = async (targets: BankChargeDraft[], rowKey?: string) => {
    if (!targets.length) return;
    if (!configComplete) {
      toast.error("Fill Tax Treatment, Paid Through, Expense Account, Place of Supply, Tax first.");
      return;
    }
    if (rowKey) setRowPosting((p) => new Set(p).add(rowKey));
    else setPosting(true);

    try {
      // Every draft's own detector-signal for VAT-inclusive gets respected —
      // a paired 0.48+0.02 draft is inclusive by construction, a standalone SWIFT is not.
      // The bar picks what account/tax/treatment those splits post against.
      const payload = {
        drafts: targets.map((d) => ({
          bankLineIds: d.bankLineIds,
          reference: d.reference,
          date: d.date,
          amount: d.amount,
          description: d.description,
          // Bar-driven fields:
          categoryAccountId: config.expenseAccountId,
          paidThroughAccountId: config.paidThroughAccountId,
          placeOfSupply: config.placeOfSupply,
          taxTreatment: config.taxTreatment,
          // Only vat_registered + a paired (inclusive) draft carries tax_id.
          // Standalone SWIFT rows post exclusive, no tax_id, regardless of bar.
          isInclusiveTax: config.taxTreatment === "vat_registered" && d.isInclusiveTax,
          taxId:
            config.taxTreatment === "vat_registered" && d.isInclusiveTax
              ? config.taxId
              : null,
        })),
      };

      const res = await fetch("/api/reconcile/bank-charges/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      const ok = (json.results ?? []).filter((r: any) => r.status === "posted").length;
      const failed = (json.results ?? []).length - ok;
      if (ok) toast.success(`Posted ${ok} bank expense${ok === 1 ? "" : "s"} to Zoho`);
      if (failed) {
        const first = (json.results ?? []).find((r: any) => r.status === "failed");
        toast.error(`${failed} failed — first: ${first?.error ?? "unknown"}`);
      }
      if (!rowKey) setSelected(new Set());
      onPosted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      if (rowKey) setRowPosting((p) => { const n = new Set(p); n.delete(rowKey); return n; });
      else setPosting(false);
    }
  };

  if (loadingRef) return (
    <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#EAE3D6] bg-[#FBF8F1] p-3 text-[13px] text-[#8A8175]">
      <Loader2 size={14} className="animate-spin" /> Loading Zoho reference data…
    </div>
  );

  if (!reference) return null;
  if (!drafts.length) return null;

  const selectedDrafts = drafts.filter((d) => selected.has(keyOf(d)));
  const targets = selectedDrafts.length ? selectedDrafts : drafts;
  const allSelected = drafts.length > 0 && drafts.every((d) => selected.has(keyOf(d)));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(drafts.map(keyOf)));

  return (
    <div className="mb-3 rounded-xl border border-[#EAE3D6] bg-[#FBF8F1] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#1F1B16]">
          <Sparkles size={14} className="text-[#B08343]" />
          Bank charges — {drafts.length} expense{drafts.length === 1 ? "" : "s"} detected
        </div>
        <button onClick={() => loadReference(true)} title="Refresh Zoho reference"
          className="rounded-full border border-[#D6CCBA] bg-white px-2.5 py-1.5 text-[12px] text-[#1F1B16] hover:bg-[#F3EFE7]">
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Config bar — one decision, applied to every selected/all row on Post. */}
      <div className="mb-3 grid gap-2 rounded-lg border border-[#EAE3D6] bg-white p-2.5 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Tax Treatment">
          <select value={config.taxTreatment}
            onChange={(e) => setConfig({ ...config, taxTreatment: e.target.value as TaxTreatment })}
            className="w-full rounded border border-[#D6CCBA] bg-white px-2 py-1 text-[12px]">
            <option value="vat_registered">VAT Registered</option>
            <option value="non_registered">Non VAT Registered</option>
          </select>
        </Field>

        <Field label="Paid Through">
          <select value={config.paidThroughAccountId}
            onChange={(e) => setConfig({ ...config, paidThroughAccountId: e.target.value })}
            className="w-full rounded border border-[#D6CCBA] bg-white px-2 py-1 text-[12px]">
            <option value="">— pick bank —</option>
            {reference.bankAccounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                [{a.account_name}] {a.account_number ?? ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Expense Account">
          <select value={config.expenseAccountId}
            onChange={(e) => setConfig({ ...config, expenseAccountId: e.target.value })}
            className="w-full rounded border border-[#D6CCBA] bg-white px-2 py-1 text-[12px]">
            <option value="">— pick account —</option>
            {reference.expenseAccounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>{a.account_name}</option>
            ))}
          </select>
        </Field>

        <Field label="Place of Supply">
          <select value={config.placeOfSupply}
            onChange={(e) => setConfig({ ...config, placeOfSupply: e.target.value as UAEEmirate })}
            className="w-full rounded border border-[#D6CCBA] bg-white px-2 py-1 text-[12px]">
            {EMIRATES.map((e) => <option key={e.code} value={e.code}>{e.name}</option>)}
          </select>
        </Field>

        <Field label="Tax">
          <select value={config.taxId}
            disabled={config.taxTreatment === "non_registered"}
            onChange={(e) => setConfig({ ...config, taxId: e.target.value })}
            className="w-full rounded border border-[#D6CCBA] bg-white px-2 py-1 text-[12px] disabled:opacity-50">
            <>

                        {reference.taxes.map(t => (
                          <option key={t.tax_id} value={t.tax_id}>{t.tax_name} [{t.tax_percentage}%]</option>
                        ))}
                        </>
          </select>
        </Field>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <button onClick={toggleAll}
          className="rounded-full border border-[#D6CCBA] bg-white px-3 py-1.5 text-[12px] text-[#1F1B16] hover:bg-[#F3EFE7]">
          {allSelected ? "Deselect all" : `Select all (${drafts.length})`}
        </button>
        <button onClick={() => post(targets)} disabled={posting || !targets.length || !configComplete}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#B08343] px-4 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">
          {posting && <Loader2 size={13} className="animate-spin" />}
          {selectedDrafts.length ? `Post ${selectedDrafts.length} selected` : `Post all (${drafts.length})`}
        </button>
      </div>

      {!configComplete && (
        <div className="mb-2 rounded-lg bg-[#FBF3E6] px-3 py-2 text-[11px] text-[#6F5325]">
          Fill the config bar above — every row posts with these values.
        </div>
      )}

      <div className="space-y-1.5">
        {drafts.map((d) => {
          const key = keyOf(d);
          const busy = rowPosting.has(key);
          return (
            <div key={key}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-[#EAE3D6] bg-white px-3 py-2 text-[12px]">
              <input type="checkbox" className="h-3.5 w-3.5"
                checked={selected.has(key)}
                onChange={() =>
                  setSelected((s) => {
                    const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n;
                  })
                } />
              <span className="text-[#8A8175]">{(d.date || "—").slice(0, 10)}</span>
              <span className="font-mono text-[#1F1B16]">{d.reference}</span>
              <span className="rounded-full bg-[#F3EFE7] px-2 py-0.5 text-[11px] text-[#8A8175]">
                {d.isInclusiveTax ? "Tax inclusive (VAT split)" : "No VAT split"}
              </span>
              <span className="text-[#8A8175]">
                covers {d.bankLineIds.length} line{d.bankLineIds.length === 1 ? "" : "s"}
              </span>
              <span className="ml-auto font-medium text-[#1F1B16]">{aed2(d.amount)}</span>
              <button onClick={() => post([d], key)} disabled={busy || posting || !configComplete}
                className="rounded-full border border-[#D6CCBA] bg-white px-2.5 py-0.5 text-[11px] text-[#1F1B16] hover:bg-[#F3EFE7] disabled:opacity-40">
                {busy ? <Loader2 size={11} className="animate-spin" /> : "Post"}
              </button>
              <span className="basis-full text-[11px] text-[#8A8175]">
                {d.reasons.join(" · ")}
              </span>
            </div>
          );
        })}
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