"use client";

/* Force-book a variance credit whose gap is too large to pass as the bank's
 * own cut (over 1% / AED 500), and post it to Zoho in the same step.
 *
 * Same accounts as the normal booking bar, all visible and editable:
 *   Deposit To        clearing account every invoice is paid into, in full
 *   Gateway charges   the gateway fee expense (+ VAT on fee for AED payouts)
 *   Exchange / diff   each order's invoice − fee − net received
 *   The gap           the credit-level shortfall/surplus — booked ONCE here
 * Then: forceBookLine() confirms the credit and writes its settlement
 * records, and /api/settlements/publish books every order in Zoho. A failed
 * order stays retryable from the booking bar below. */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Gavel, Loader2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { PostingOptions } from "@/lib/integrations/zoho-settlement-posting";
import type { OrderPublishResult, WirePublishResult } from "@/lib/finance/publish-settlements";
import { isCrossBorderCurrency, suggestPostingAccounts } from "@/lib/finance/settlement-posting";
import { AccountSelect, readPrefs, writePrefs } from "./gateway-proof";
import { aed2, type ReconLine } from "./types";

type Option = { account_id: string; account_name: string; account_type: string };

const BANK_FEE = /bank (fees?|charges?)/i;
const GATEWAY_FEE = /gateway|merchant|payment (processing|charges)/i;
const FX = /exchange/i;

export function defaultForceNote(r: ReconLine): string {
  const gap = Math.abs(r.variance);
  const kind = r.variance < 0 ? "shortfall" : "surplus";
  return `${r.provider} payout ${r.payout?.id ?? ""} says ${aed2(r.payout?.net ?? 0)}, bank credited ${aed2(r.bankAmount)}` +
    `${r.reference ? ` (ref ${r.reference})` : ""}: ${kind} of ${aed2(gap)} ` +
    `(${((gap / (r.bankAmount || 1)) * 100).toFixed(2)}%). Booked by founder; invoices close in full.`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: { error?: string } & T;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(res.status === 401 ? "Your session expired. Sign in again." : `Server returned HTTP ${res.status} instead of data. Nothing more was changed.`);
  }
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export function ForceBookPanel({ r, onDone, onCancel }: { r: ReconLine; onDone: () => void; onCancel: () => void }) {
  const currency = r.payout?.currency ?? null;
  const crossBorder = isCrossBorderCurrency(currency);
  const prefsKey = `omnia.gatewayPosting.${r.provider}.${currency ?? "AED"}`;
  const shortfall = r.variance < 0;
  const gap = Math.abs(r.variance);

  const [options, setOptions] = useState<PostingOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [depositAccountId, setDepositAccountId] = useState("");
  const [feeAccountId, setFeeAccountId] = useState("");
  const [vatTaxId, setVatTaxId] = useState("");
  const [differenceAccountId, setDifferenceAccountId] = useState("");
  const [gapAccountId, setGapAccountId] = useState("");
  const [note, setNote] = useState(() => defaultForceNote(r));
  const [useCustomRef, setUseCustomRef] = useState(false);
  const [customRef, setCustomRef] = useState("");
  const [step, setStep] = useState<"idle" | "confirming" | "booking" | "posting">("idle");
  const [result, setResult] = useState<{ results: OrderPublishResult[]; wire?: WirePublishResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Cached server-side for 10 minutes: reopening costs no Zoho calls.
    fetch("/api/settlements/posting-options")
      .then(async (x) => {
        const j = await x.json();
        if (!x.ok) throw new Error(j.error || `HTTP ${x.status}`);
        return j as PostingOptions;
      })
      .then((d) => {
        setOptions(d);
        // Same defaults as the booking bar: last choice for this gateway and
        // currency, else the best-named account.
        const suggested = suggestPostingAccounts({ provider: r.provider, currency }, d);
        const saved = readPrefs(prefsKey);
        const valid = (id: string | undefined, list: { account_id?: string; tax_id?: string }[]) =>
          id !== undefined && (id === "" || list.some((o) => (o.account_id ?? o.tax_id) === id));
        setDepositAccountId(valid(saved.depositAccountId, d.depositAccounts) ? saved.depositAccountId! : suggested.depositAccountId);
        setFeeAccountId(valid(saved.feeAccountId, d.feeAccounts) ? saved.feeAccountId! : suggested.feeAccountId);
        setDifferenceAccountId(valid(saved.differenceAccountId, d.differenceAccounts) ? saved.differenceAccountId! : suggested.differenceAccountId);
        setVatTaxId(!crossBorder && valid(saved.vatTaxId, d.taxes) ? saved.vatTaxId! : suggested.vatTaxId);
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [r.provider, currency, crossBorder, prefsKey]);

  // The gap can go to any expense or difference account.
  const gapAccounts = useMemo(() => {
    const m = new Map<string, Option>();
    for (const a of [...(options?.feeAccounts ?? []), ...(options?.differenceAccounts ?? [])]) m.set(a.account_id, a);
    return [...m.values()].sort((a, b) => a.account_name.localeCompare(b.account_name));
  }, [options]);

  // A shortfall is usually a bank or gateway charge; a surplus an FX gain.
  useEffect(() => {
    if (gapAccountId || gapAccounts.length === 0) return;
    const saved = readPrefs(`${prefsKey}.forceGap`).gapAccountId;
    if (saved && gapAccounts.some((a) => a.account_id === saved)) return setGapAccountId(saved);
    for (const re of shortfall ? [BANK_FEE, GATEWAY_FEE, FX] : [FX, BANK_FEE]) {
      const hit = gapAccounts.find((a) => re.test(a.account_name));
      if (hit) return setGapAccountId(hit.account_id);
    }
  }, [gapAccounts, gapAccountId, shortfall, prefsKey]);

  const nameIn = (list: { account_id: string; account_name: string }[] | undefined, id: string) =>
    list?.find((a) => a.account_id === id)?.account_name ?? "";
  const depositName = nameIn(options?.depositAccounts, depositAccountId);
  const feeName = nameIn(options?.feeAccounts, feeAccountId);
  const differenceName = nameIn(options?.differenceAccounts, differenceAccountId);
  const gapName = nameIn(gapAccounts, gapAccountId);
  const vatName = options?.taxes.find((t) => t.tax_id === vatTaxId)?.tax_name ?? "";

  const missing =
    !depositAccountId ? "Pick the Deposit To account" :
    !feeAccountId ? "Pick the gateway charges account" :
    !differenceAccountId ? "Pick the exchange gain / loss account" :
    !gapAccountId ? "Pick the account the gap books to" :
    !note.trim() ? "Say why this is being booked" :
    null;

  const run = async () => {
    if (missing) return toast.error(`${missing}.`);
    setError(null);
    setResult(null);
    writePrefs(prefsKey, { depositAccountId, feeAccountId, vatTaxId, differenceAccountId });
    writePrefs(`${prefsKey}.forceGap`, { gapAccountId });
    try {
      // 1. Confirm the credit as force-booked; writes its settlement records.
      setStep("booking");
      await postJson("/api/reconcile/force-book", {
        bankLineId: r.id, note, accountId: gapAccountId, accountName: gapName, actor: "founder",
      });
      // 2. Book every order in Zoho: payment in full → fee → FX, then the gap once.
      setStep("posting");
      const out = await postJson<{ results?: OrderPublishResult[]; wire?: WirePublishResult }>("/api/settlements/publish", {
        bankLineId: r.id,
        depositAccountId,
        feeAccountId,
        vatTaxId: crossBorder ? "" : vatTaxId,
        differenceAccountId,
        referenceNumberOverride: useCustomRef && customRef.trim() ? customRef.trim() : undefined,
        dryRun: false,
      });
      const results = out.results ?? [];
      setResult({ results, wire: out.wire });
      const good = results.filter((x) => x.ok).length;
      const bad = results.length - good;
      const wireOk = !out.wire || out.wire.ok;
      if (bad === 0 && wireOk) toast.success(`Closed ${good} invoice${good === 1 ? "" : "s"} in Zoho and booked the ${aed2(gap)} gap.`);
      else toast.error(`${good} closed, ${bad} not${wireOk ? "" : ", gap not booked"}. See the list; retry from the booking bar.`);
    } catch (e) {
      setError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setStep("idle");
    }
  };

  const busy = step === "booking" || step === "posting";
  const done = !!result;

  return (
    <div className="mb-3.5 rounded-xl border border-[#D6CCBA] bg-white p-4 text-[13px] text-[#1F1B16]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[14px] font-semibold"><Gavel size={15} /> Force book and close {r.resolvedOrders.length} invoice{r.resolvedOrders.length === 1 ? "" : "s"}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-[#6F5325]">
            Bank credited <b>{aed2(r.bankAmount)}</b>, {r.provider} payout says <b>{aed2(r.payout?.net ?? 0)}</b>: a{" "}
            {shortfall ? "shortfall" : "surplus"} of <b>{aed2(gap)}</b>.
            {r.unresolvedRefs.length > 0 && <> {r.unresolvedRefs.length} unmatched line(s) stay open until linked.</>}
          </p>
        </div>
        <button onClick={done ? onDone : onCancel} aria-label="Close" className="text-[#8A8175]"><X size={15} /></button>
      </div>

      {loadError ? (
        <div className="mb-3 rounded-md bg-[#F9ECE7] px-3 py-2 text-[12px] text-[#A6472F]">Couldn&apos;t load Zoho accounts: {loadError}</div>
      ) : !options ? (
        <div className="mb-3 flex items-center gap-1.5 text-[12px] text-[#8A8175]"><Loader2 size={12} className="animate-spin" /> Loading Zoho accounts…</div>
      ) : (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AccountSelect
            label="Deposit to" hint="invoice closes in full"
            value={depositAccountId} onChange={setDepositAccountId} placeholder="Select clearing account…"
            options={options.depositAccounts.map((a) => ({ id: a.account_id, name: a.account_name }))}
          />
          <AccountSelect
            label="Gateway charges" hint="fee expense"
            value={feeAccountId} onChange={setFeeAccountId} placeholder="Select expense account…"
            options={options.feeAccounts.map((a) => ({ id: a.account_id, name: a.account_name }))}
          />
          {!crossBorder && (
            <AccountSelect
              label="VAT on fee" hint="fee ÷ 105 × 5"
              value={vatTaxId} onChange={setVatTaxId} placeholder="Select tax…" allowNone="No VAT on this fee"
              options={options.taxes.filter((t) => t.tax_percentage > 0).map((t) => ({ id: t.tax_id, name: `${t.tax_name} (${t.tax_percentage}%)` }))}
            />
          )}
          <AccountSelect
            label="Exchange gain / loss" hint="per-order difference"
            value={differenceAccountId} onChange={setDifferenceAccountId} placeholder="Select account…"
            options={options.differenceAccounts.map((a) => ({ id: a.account_id, name: a.account_name }))}
          />
          <div className="sm:col-span-2">
            <AccountSelect
              label={`The ${aed2(gap)} ${shortfall ? "shortfall" : "surplus"}`} hint="booked once, never spread over orders"
              value={gapAccountId} onChange={setGapAccountId} placeholder="Select account…"
              options={gapAccounts.map((a) => ({ id: a.account_id, name: `${a.account_name} · ${a.account_type}` }))}
            />
          </div>
        </div>
      )}

      <label className="mb-2 block text-[12px] font-medium">
        Why (saved on the credit and written into the Zoho journal)
        <textarea
          value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          className="mt-1 w-full rounded-lg border border-[#D6CCBA] bg-white px-3 py-2 text-[12.5px] leading-relaxed outline-none focus:border-[#B08343]"
        />
      </label>

      <label className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-[#6F6457]">
        <input type="checkbox" checked={useCustomRef} onChange={(e) => setUseCustomRef(e.target.checked)} />
        Use a custom reference number
        {useCustomRef && (
          <input
            value={customRef} onChange={(e) => setCustomRef(e.target.value)} placeholder={r.reference || r.id}
            className="rounded-md border border-[#D6CCBA] px-2 py-1 text-[12px]"
          />
        )}
      </label>

      <div className="mb-3 rounded-lg bg-[#FBF3E6] px-3 py-2.5 text-[12px] leading-relaxed text-[#6F5325]">
        Each of the {r.resolvedOrders.length} invoices is paid <b>in full</b> into <b>{depositName || "the deposit account"}</b>.
        The {r.provider} fee goes to <b>{feeName || "gateway charges"}</b>
        {!crossBorder && vatTaxId ? <> with input VAT (<b>{vatName}</b>)</> : <> with no VAT</>}.
        Each order&apos;s invoice − fee − net received goes to <b>{differenceName || "exchange gain / loss"}</b>.
        The <b>{aed2(gap)}</b> {shortfall ? "shortfall" : "surplus"} books once to <b>{gapName || "the gap account"}</b>,
        leaving {depositName || "the clearing account"} at the {aed2(r.bankAmount)} the bank actually credited.
      </div>

      {error && <div className="mb-3 rounded-md bg-[#F9ECE7] px-3 py-2 text-[12px] text-[#A6472F]">{error}</div>}

      {result && (
        <div className="mb-3 space-y-1 rounded-lg border border-[#EAE3D6] p-2.5 text-[12px]">
          {result.results.map((x) => (
            <div key={x.settlementId} className="flex items-start gap-1.5">
              {x.ok ? <CheckCircle2 size={13} className="mt-0.5 text-[#4B7A54]" /> : <XCircle size={13} className="mt-0.5 text-[#A6472F]" />}
              <span>
                <b>#{x.orderNumber}</b>{x.invoiceNumber ? ` · ${x.invoiceNumber}` : ""} · {x.ok ? "invoice closed" : x.message || x.status}
                {x.plan && x.ok && <span className="text-[#8A8175]"> · paid {aed2(x.plan.paymentAmount)}, fee {aed2(x.plan.fee)}{x.plan.difference ? `, diff ${aed2(x.plan.difference)}` : ""}</span>}
              </span>
            </div>
          ))}
          {result.wire && (
            <div className="flex items-start gap-1.5 border-t border-[#EAE3D6] pt-1">
              {result.wire.ok ? <CheckCircle2 size={13} className="mt-0.5 text-[#4B7A54]" /> : <XCircle size={13} className="mt-0.5 text-[#A6472F]" />}
              <span>Gap {aed2(Math.abs(result.wire.amount))} → {gapName}: {result.wire.status.replace("_", " ")}{result.wire.message ? ` (${result.wire.message})` : ""}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {missing && !done && <span className="mr-auto text-[12px] text-[#A6472F]">{missing}</span>}
        {done ? (
          <button onClick={onDone} className="rounded-lg bg-[#B08343] px-4 py-2 text-[12.5px] font-medium text-white">Done</button>
        ) : step === "confirming" ? (
          <>
            <span className="mr-auto text-[12px] text-[#6F5325]">This writes {r.resolvedOrders.length} payments, their fees and one gap journal to Zoho.</span>
            <button onClick={() => setStep("idle")} className="rounded-lg border border-[#D6CCBA] bg-white px-3 py-2 text-[12.5px]">Back</button>
            <button onClick={run} className="inline-flex items-center gap-1.5 rounded-lg bg-[#A6472F] px-4 py-2 text-[12.5px] font-medium text-white">
              <Gavel size={13} /> Yes, book it
            </button>
          </>
        ) : (
          <>
            <button onClick={onCancel} disabled={busy} className="rounded-lg border border-[#D6CCBA] bg-white px-3 py-2 text-[12.5px]">Cancel</button>
            <button
              onClick={() => setStep("confirming")}
              disabled={busy || !!missing || !options}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#A6472F] px-4 py-2 text-[12.5px] font-medium text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Gavel size={13} />}
              {step === "booking" ? "Confirming credit…" : step === "posting" ? "Posting to Zoho…" : `Force book & close ${r.resolvedOrders.length} invoice${r.resolvedOrders.length === 1 ? "" : "s"}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
