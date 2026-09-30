"use client";

/* A COD courier voucher's delivery / return charges — the rows with no cash
 * collected (Pro Price 0). They close no invoice, and they are not all the
 * voucher company's: a prepaid order's charge belongs to the company that sold
 * it (lib/finance/delivery-entities.ts). Each row shows its company and why;
 * the charges then book per company, a Zoho line per order:
 *
 *   voucher company's own   one expense out of clearing              (/DLV)
 *   a sister company's      voucher company: Dr Due from sister / Cr clearing
 *                           sister company:  expense paid through Due to …
 *                                                               (/DLV-IC-<org>)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Building2, ChevronDown, Loader2, RotateCcw, Truck } from "lucide-react";
import { toast } from "sonner";
import type { DeliveryLegResult, DeliveryPublishResult } from "@/lib/finance/publish-settlements";
import type { AssignedDeliveryCharge, DeliveryEntityGroup } from "@/lib/finance/delivery-entities";
import type { DeliveryPosting } from "@/lib/finance/delivery-entities.server";
import type { PostingOptions } from "@/lib/integrations/zoho-settlement-posting";
import { AccountSelect, readPrefs, writePrefs } from "./gateway-proof";
import { aed2, type ReconLine } from "./types";

const OWN_PREF = "omnia.cod.deliveryAccountId";
const icPrefKey = (voucherOrg: string, org: string) => `omnia.cod.delivery.ic.${voucherOrg}.${org}`;
const DELIVERY_RE = /deliver|shipping|courier|freight|postage/i;

type EntityState = {
  voucherOrg: string;
  charges: AssignedDeliveryCharge[];
  groups: DeliveryEntityGroup[];
  orgs: { id: string; label: string }[];
  postings: DeliveryPosting[];
};
type IcAccounts = { dueFromAccountId: string; expenseAccountId: string; dueToAccountId: string; vatTaxId: string };
const EMPTY_IC: IcAccounts = { dueFromAccountId: "", expenseAccountId: "", dueToAccountId: "", vatTaxId: "" };

const REASON_TEXT: Record<AssignedDeliveryCharge["reason"], string> = {
  manual: "picked", settled: "settled", cod: "COD", prepaid: "prepaid", unknown: "check",
};

/** Letters only, lower case — "Omniastores LLC" ~ "Omnia Stores- Dubai". */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
/** The account whose name names the other company, else a related-party one. */
function guessIntercompany(accounts: { account_id: string; account_name: string }[], otherLabel: string): string {
  const words = squash(otherLabel.replace(/\b(llc|l\.l\.c|fze|fzco|trading|organisation|organization)\b/gi, ""));
  return (
    (words.length >= 5 ? accounts.find((a) => squash(a.account_name).includes(words.slice(0, 11))) : undefined)?.account_id ??
    accounts.find((a) => /sis(ter)?\s*company|inter-?company|related\s*party/i.test(a.account_name))?.account_id ??
    ""
  );
}

export function DeliveryChargesPanel({
  r, voucherOptions, depositAccountId, vatTaxId, vatName, referenceOverride,
}: {
  r: ReconLine;
  /** Accounts and taxes of the organisation the voucher settles into. */
  voucherOptions: PostingOptions | null;
  depositAccountId: string;
  vatTaxId: string;
  vatName: string;
  referenceOverride?: string;
}) {
  const payoutId = r.payout?.id ?? "";
  const rowCount = r.payout?.deliveryCharges?.length ?? 0;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<EntityState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [ownAccountId, setOwnAccountId] = useState("");
  const [ic, setIc] = useState<Record<string, IcAccounts>>({});
  const [sisterOptions, setSisterOptions] = useState<Record<string, PostingOptions | "error">>({});
  const [busy, setBusy] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const [result, setResult] = useState<DeliveryPublishResult | null>(null);

  const load = useCallback(async () => {
    if (!payoutId) return;
    try {
      const res = await fetch(`/api/payouts/${encodeURIComponent(payoutId)}/delivery-entities`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setState(j);
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [payoutId]);
  useEffect(() => { void load(); }, [load]);

  const label = useCallback((id: string) => state?.orgs.find((o) => o.id === id)?.label ?? id, [state]);
  const sisters = useMemo(() => state?.groups.filter((g) => !g.own) ?? [], [state]);
  const ownGroup = state?.groups.find((g) => g.own);

  // Each sister company's own accounts and taxes (posting options are cached server-side).
  useEffect(() => {
    for (const g of sisters) {
      if (sisterOptions[g.entity]) continue;
      fetch(`/api/settlements/posting-options?zohoOrg=${encodeURIComponent(g.entity)}`)
        .then(async (res) => { const j = await res.json(); if (!res.ok) throw new Error(j.error); return j as PostingOptions; })
        .then((o) => setSisterOptions((m) => ({ ...m, [g.entity]: o })))
        .catch(() => setSisterOptions((m) => ({ ...m, [g.entity]: "error" })));
    }
  }, [sisters, sisterOptions]);

  // Own delivery account: remembered, else a name that says delivery.
  useEffect(() => {
    const accounts = voucherOptions?.feeAccounts ?? [];
    if (ownAccountId || accounts.length === 0) return;
    const saved = readPrefs(OWN_PREF).accountId;
    if (saved && accounts.some((a) => a.account_id === saved)) return setOwnAccountId(saved);
    const guess = accounts.find((a) => DELIVERY_RE.test(a.account_name));
    if (guess) setOwnAccountId(guess.account_id);
  }, [voucherOptions, ownAccountId]);

  // Sister accounts: remembered per (voucher org, sister), else guessed by name.
  useEffect(() => {
    if (!state || !voucherOptions) return;
    setIc((prev) => {
      let next = prev;
      for (const g of sisters) {
        const opts = sisterOptions[g.entity];
        if (prev[g.entity] || !opts || opts === "error") continue;
        const saved = readPrefs(icPrefKey(state.voucherOrg, g.entity));
        const has = (list: { account_id: string }[] | undefined, id?: string) => !!id && !!list?.some((a) => a.account_id === id);
        const five = opts.taxes.find((t) => t.tax_percentage === 5)?.tax_id ?? "";
        next = {
          ...next,
          [g.entity]: {
            dueFromAccountId: has(voucherOptions.intercompanyAccounts, saved.dueFromAccountId) ? saved.dueFromAccountId!
              : guessIntercompany(voucherOptions.intercompanyAccounts ?? [], label(g.entity)),
            expenseAccountId: has(opts.feeAccounts, saved.expenseAccountId) ? saved.expenseAccountId!
              : opts.feeAccounts.find((a) => /^delivery charges$/i.test(a.account_name.trim()))?.account_id
                ?? opts.feeAccounts.find((a) => DELIVERY_RE.test(a.account_name))?.account_id ?? "",
            dueToAccountId: has(opts.intercompanyAccounts, saved.dueToAccountId) ? saved.dueToAccountId!
              : guessIntercompany(opts.intercompanyAccounts ?? [], label(state.voucherOrg)),
            vatTaxId: saved.vatTaxId !== undefined && (saved.vatTaxId === "" || opts.taxes.some((t) => t.tax_id === saved.vatTaxId)) ? saved.vatTaxId : five,
          },
        };
      }
      return next;
    });
  }, [state, voucherOptions, sisters, sisterOptions, label]);

  if (rowCount === 0) return null;

  const total = Math.round((state?.charges ?? r.payout?.deliveryCharges ?? []).reduce((s, c) => s + c.amount, 0) * 100) / 100;
  const returns = (state?.charges ?? []).filter((c) => c.isReturn).length;
  const setIcField = (org: string, field: keyof IcAccounts, v: string) =>
    setIc((m) => ({ ...m, [org]: { ...(m[org] ?? EMPTY_IC), [field]: v } }));
  const bookedDoc = (c: AssignedDeliveryCharge) => state?.postings.find((p) => p.org === c.entity && p.refs.includes(c.ref));

  const move = async (c: AssignedDeliveryCharge, org: string) => {
    setSavingKey(c.key);
    try {
      const res = await fetch(`/api/payouts/${encodeURIComponent(payoutId)}/delivery-entities`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: { [c.key]: org === "__auto__" ? null : org } }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setState(j);
      setResult(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingKey("");
    }
  };

  const book = async (dryRun: boolean) => {
    if (!state) return;
    if (!depositAccountId) return toast.error("Pick the Deposit To (clearing) account first.");
    if (ownGroup && !ownAccountId) return toast.error(`Pick ${label(state.voucherOrg)}'s delivery charges account first.`);
    if (ownAccountId) writePrefs(OWN_PREF, { accountId: ownAccountId });
    for (const g of sisters) if (ic[g.entity]) writePrefs(icPrefKey(state.voucherOrg, g.entity), ic[g.entity]);
    setBusy(true);
    try {
      const res = await fetch("/api/settlements/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankLineId: r.id, deliveryOnly: true, depositAccountId, feeAccountId: ownAccountId,
          deliveryAccountId: ownAccountId, vatTaxId, referenceNumberOverride: referenceOverride, dryRun,
          deliveryIntercompany: Object.fromEntries(sisters.map((g) => {
            const opts = sisterOptions[g.entity];
            return [g.entity, { ...(ic[g.entity] ?? EMPTY_IC), inputVatAccountId: opts && opts !== "error" ? opts.inputVatAccountId ?? "" : "" }];
          })),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      const d = j.delivery as DeliveryPublishResult | undefined;
      setResult(d ?? null);
      if (!d) toast.message("No delivery charges on this credit.");
      else if (!d.ok) toast.error(d.message ?? "Delivery charges not booked.");
      else toast.success(
        d.status === "planned" ? `Preview: ${d.legs.filter((l) => l.status === "planned").length} document(s) would be booked.`
        : d.status === "found_existing" ? "Already in Zoho — nothing booked again."
        : `Booked ${d.count} delivery charges, ${aed2(d.amount)}, in Zoho.`,
      );
      if (!dryRun) void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const voucherLabel = state ? label(state.voucherOrg) : "this company";

  return (
    <div className="rounded-lg border border-[#D8E1F1] bg-[#F3F6FC] p-3 text-[12px] text-[#0F1B3D]">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="inline-flex flex-wrap items-center gap-1.5 font-semibold">
          <Truck size={13} /> Delivery charges · {rowCount} row{rowCount === 1 ? "" : "s"}
          {returns > 0 && <span className="font-normal text-[#5E6B85]">({returns} return{returns === 1 ? "" : "s"})</span>}
          · <span className="tabular-nums">{aed2(total)}</span>
          {state && state.groups.map((g) => (
            <span key={g.entity} className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ${g.own ? "bg-white text-[#1E3A8A]" : "bg-[#FFF4E0] text-[#8A5A00]"}`}>
              {label(g.entity)} {g.charges.length} · {aed2(g.total)}
            </span>
          ))}
        </span>
        <ChevronDown size={13} className={`flex-shrink-0 text-[#5E6B85] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <p className="mt-1 text-[11.5px] leading-relaxed text-[#1E3A8A]">
        Rows where the courier collected no cash: it delivered a prepaid order or took a return, and kept its charge
        from {voucherLabel}&apos;s remittance. Each charge books in the company that owns the order, one Zoho line per
        order number. A sister company&apos;s charges go through the intercompany accounts, because {voucherLabel} paid them.
      </p>
      {loadError && <p className="mt-1 text-[11.5px] text-[#A6472F]">Couldn&apos;t load which company each charge belongs to: {loadError}</p>}

      {open && state && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-[#D8E1F1] bg-white">
          <table className="w-full text-[11.5px]">
            <thead className="sticky top-0 bg-[#F3F6FC] text-left text-[10.5px] uppercase tracking-wide text-[#5E6B85]">
              <tr><th className="px-2 py-1">Order</th><th className="px-2 py-1">Voucher</th><th className="px-2 py-1 text-right">Charge</th>
                <th className="px-2 py-1">Books in</th><th className="px-2 py-1">Why</th></tr>
            </thead>
            <tbody>
              {state.charges.map((c) => {
                const posted = bookedDoc(c);
                return (
                  <tr key={c.key} className="border-t border-[#D8E1F1] align-middle">
                    <td className="px-2 py-1 font-mono">
                      #{c.ref}{c.isReturn && <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-[#EEF2FA] px-1.5 text-[10px] text-[#5E6B85]"><RotateCcw size={9} /> return</span>}
                    </td>
                    <td className="px-2 py-1 font-mono text-[#5E6B85]">{c.voucherNo}</td>
                    <td className="px-2 py-1 text-right font-medium tabular-nums" title={`${aed2(c.exVat)} + VAT ${aed2(c.vat)}`}>{aed2(c.amount)}</td>
                    <td className="px-2 py-1">
                      {posted ? (
                        <span className="text-[#4B7A54]" title={`${posted.kind} ${posted.id} · ${posted.reference}`}>{label(c.entity)} · booked</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <select
                            value={c.reason === "manual" ? c.entity : "__auto__"}
                            onChange={(e) => void move(c, e.target.value)}
                            disabled={!!savingKey}
                            aria-label={`Company for order ${c.ref}`}
                            className="h-6 rounded border-0 bg-transparent px-1 text-[11.5px] ring-1 ring-inset ring-[#D8E1F1] focus:ring-2 focus:ring-[#1D4ED8]"
                          >
                            <option value="__auto__">{c.reason === "manual" ? "Automatic" : `${label(c.entity)} (auto)`}</option>
                            {state.orgs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                          </select>
                          {savingKey === c.key && <Loader2 size={11} className="animate-spin" />}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-[#5E6B85]" title={c.why}>
                      <span className={`mr-1 rounded-full px-1.5 text-[10px] ${c.reason === "unknown" ? "bg-[#F9ECE7] text-[#A6472F]" : "bg-[#EEF2FA]"}`}>{REASON_TEXT[c.reason]}</span>
                      <span className="hidden sm:inline">{c.why}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {state && ownGroup && (
        <div className="mt-2 rounded-md border border-[#D8E1F1] bg-white p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold">
            <Building2 size={12} className="text-[#1D4ED8]" /> {voucherLabel}&apos;s own · {ownGroup.charges.length} · {aed2(ownGroup.total)}
            <span className="font-normal text-[#5E6B85]">one expense out of clearing{vatTaxId ? <>, input VAT {vatName}</> : <>, no VAT</>}</span>
          </div>
          <AccountSelect
            label="Delivery charges account" hint="expense"
            value={ownAccountId} onChange={setOwnAccountId} placeholder="Select expense account…"
            options={(voucherOptions?.feeAccounts ?? []).map((a) => ({ id: a.account_id, name: a.account_name }))}
          />
        </div>
      )}

      {state && sisters.map((g) => {
        const opts = sisterOptions[g.entity];
        const a = ic[g.entity] ?? EMPTY_IC;
        const sister = label(g.entity);
        return (
          <div key={g.entity} className="mt-2 rounded-md border border-[#F0DDB8] bg-[#FFFBF3] p-2.5">
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11.5px] font-semibold">
              <ArrowLeftRight size={12} className="text-[#8A5A00]" /> {sister}&apos;s · {g.charges.length} · {aed2(g.total)}
              <span className="font-normal text-[#5E6B85]">paid by {voucherLabel} on its behalf, so booked as intercompany</span>
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-[#6B5220]">
              In <b>{voucherLabel}</b>: journal, Dr <b>Due from {sister}</b> (a line per order) / Cr clearing {aed2(g.total)}.
              In <b>{sister}</b>: an expense with a line per order, paid through <b>Due to {voucherLabel}</b>. The two intercompany balances mirror each other.
            </p>
            {opts === "error" ? (
              <p className="text-[11.5px] text-[#A6472F]">Couldn&apos;t load {sister}&apos;s accounts. Check its connection in Settings.</p>
            ) : !opts ? (
              <p className="inline-flex items-center gap-1 text-[11.5px] text-[#5E6B85]"><Loader2 size={11} className="animate-spin" /> loading {sister}&apos;s accounts…</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <AccountSelect label={`Due from ${sister}`} hint={`in ${voucherLabel}`} value={a.dueFromAccountId}
                  onChange={(v) => setIcField(g.entity, "dueFromAccountId", v)} placeholder="Select account…"
                  options={(voucherOptions?.intercompanyAccounts ?? []).map((x) => ({ id: x.account_id, name: x.account_name }))} />
                <AccountSelect label="Delivery charges account" hint={`in ${sister}`} value={a.expenseAccountId}
                  onChange={(v) => setIcField(g.entity, "expenseAccountId", v)} placeholder="Select expense account…"
                  options={opts.feeAccounts.map((x) => ({ id: x.account_id, name: x.account_name }))} />
                <AccountSelect label={`Due to ${voucherLabel}`} hint={`in ${sister}`} value={a.dueToAccountId}
                  onChange={(v) => setIcField(g.entity, "dueToAccountId", v)} placeholder="Select account…"
                  options={(opts.intercompanyAccounts ?? []).map((x) => ({ id: x.account_id, name: x.account_name }))} />
                <AccountSelect label="VAT" hint={`${sister}'s input VAT`} value={a.vatTaxId} allowNone="No VAT"
                  onChange={(v) => setIcField(g.entity, "vatTaxId", v)} placeholder="Select tax…"
                  options={opts.taxes.map((t) => ({ id: t.tax_id, name: `${t.tax_name} (${t.tax_percentage}%)` }))} />
              </div>
            )}
          </div>
        );
      })}

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <button onClick={() => book(true)} disabled={busy || !state}
          className="rounded-md border border-[#C9D5EA] bg-white px-3 py-1.5 text-[12px] disabled:opacity-50">Preview</button>
        <button onClick={() => book(false)} disabled={busy || !state || !depositAccountId}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#0F1B3D] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">
          {busy && <Loader2 size={12} className="animate-spin" />} Book {aed2(total)}
          {sisters.length > 0 ? ` across ${sisters.length + (ownGroup ? 1 : 0)} companies` : ""}
        </button>
      </div>

      {result && (
        <ul className="mt-2 space-y-1">
          {result.legs.map((l) => <LegRow key={`${l.org}-${l.kind}-${l.reference}`} leg={l} label={label} />)}
        </ul>
      )}
    </div>
  );
}

function LegRow({ leg, label }: { leg: DeliveryLegResult; label: (id: string) => string }) {
  const good = leg.ok;
  const what = `${leg.kind}${leg.leg === "own" ? "" : " (intercompany)"}`;
  const text =
    leg.status === "booked" ? `Booked · ${leg.kind} ${leg.id}${leg.message ? ` · ${leg.message}` : ""}`
    : leg.status === "found_existing" ? `Already in Zoho · ${leg.kind} ${leg.id}${leg.message ? ` · ${leg.message}` : ""}`
    : leg.status === "planned" ? "Would book"
    : leg.message ?? leg.status;
  return (
    <li className={`rounded-md px-2.5 py-1.5 text-[11.5px] ${good ? "bg-[#F0F5EF] text-[#4B7A54]" : "bg-[#F9ECE7] text-[#A6472F]"}`}>
      <b>{label(leg.org)}</b> {what} · {leg.refs.length} order{leg.refs.length === 1 ? "" : "s"} · {aed2(leg.amount)} · ref {leg.reference} — {text}
    </li>
  );
}
