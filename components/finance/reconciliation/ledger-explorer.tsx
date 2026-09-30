"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleDashed, Search, X } from "lucide-react";
import { GROUP_LABEL, gatewayOf, type AccountSummary, type LedgerGroup, type LedgerLine } from "@/lib/reconciliation/ledger-insights";
import { gatewayColor } from "./colors";
import { aed2 } from "./types";

/* Accounts table + line-level ledger for the Ledger tab.
 *
 * This is the part that replaces "export the ledger to Excel and filter it":
 * every watched account's month in one searchable list, with the link state
 * against what Omnia booked, so the accountant starts from the exceptions. */

const GROUP_ORDER: LedgerGroup[] = ["clearing", "bank", "fees", "fx", "sales", "tax", "receivable", "refunds"];
const PAGE = 100;

const th = "px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-[#5E6B85]";
const num = "px-3 py-2 text-right font-mono tabular-nums";

function Dot({ name, group }: { name: string; group: LedgerGroup }) {
  const g = group === "clearing" ? gatewayOf(name) : null;
  return <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g ? gatewayColor(g) : "#C9D5EA" }} aria-hidden />;
}

function LinkBadge({ linked }: { linked: boolean | null }) {
  if (linked == null) return <span className="text-[11px] text-[#97A3BA]">—</span>;
  return linked ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4B7A54]"><CheckCircle2 size={12} aria-hidden /> In Omnia</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF1FD] px-1.5 py-0.5 text-[11px] font-medium text-[#8A5A14]"><CircleDashed size={12} aria-hidden /> Not linked</span>
  );
}

export type ExplorerFocus = { accountId: string; onlyUnlinked: boolean; nonce: number };

export function LedgerExplorer({ summaries, lines, isCurrentMonth, focus }: {
  summaries: AccountSummary[];
  lines: LedgerLine[];
  isCurrentMonth: boolean;
  /** Set by a close-checklist "Show lines" — filters and scrolls here. */
  focus?: ExplorerFocus | null;
}) {
  const [accountId, setAccountId] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const linesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    setAccountId(focus.accountId); setOnlyUnlinked(focus.onlyUnlinked); setType("all"); setQuery(""); setShown(PAGE);
    linesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus]);

  const byId = useMemo(() => new Map(summaries.map((s) => [s.account_id, s])), [summaries]);
  const grouped = useMemo(() => GROUP_ORDER
    .map((g) => ({ group: g, rows: summaries.filter((s) => s.group === g && (s.lineCount > 0 || s.balance)) }))
    .filter((g) => g.rows.length > 0), [summaries]);

  const scoped = useMemo(() => (accountId === "all" ? lines : lines.filter((l) => l.accountId === accountId)), [lines, accountId]);
  const types = useMemo(() => [...new Set(scoped.map((l) => l.typeLabel || l.type))].filter(Boolean).sort(), [scoped]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qNum = Number(q.replace(/,/g, ""));
    return scoped.filter((l) => {
      if (onlyUnlinked && l.linked !== false) return false;
      if (type !== "all" && (l.typeLabel || l.type) !== type) return false;
      if (!q) return true;
      if (Number.isFinite(qNum) && qNum > 0 && (Math.abs(l.debit - qNum) < 0.005 || Math.abs(l.credit - qNum) < 0.005)) return true;
      return [l.ref, l.entry, l.payee, l.desc, l.offset, l.txnId].some((f) => f.toLowerCase().includes(q));
    });
  }, [scoped, query, type, onlyUnlinked]);

  const foot = useMemo(() => filtered.reduce((t, l) => ({ d: t.d + l.debit, c: t.c + l.credit }), { d: 0, c: 0 }), [filtered]);

  const pick = (id: string) => { setAccountId(id); setType("all"); setShown(PAGE); };
  const selected = accountId === "all" ? null : byId.get(accountId);

  return (
    <div className="space-y-4">
      {/* ── Accounts ── */}
      <div className="overflow-hidden rounded-2xl border border-[#D8E1F1] bg-white shadow-sm">
        <div className="border-b border-[#D8E1F1] px-5 py-3.5">
          <h3 className="text-[14.5px] font-semibold text-[#0F1B3D]">Accounts this month</h3>
          <p className="text-[12.5px] text-[#5E6B85]">
            Movement is in each account&apos;s natural direction (money in for clearing and bank, income for sales).
            {isCurrentMonth ? " Opening is today's Zoho balance minus this month's movement." : " Balances are shown for the current month only."}
            {" "}Click an account to open its ledger.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-[#F3F6FC]">
                <th className={`${th} text-left`}>Account</th>
                <th className={`${th} text-right`}>Opening</th>
                <th className={`${th} text-right`}>Debits</th>
                <th className={`${th} text-right`}>Credits</th>
                <th className={`${th} text-right`}>Balance now</th>
                <th className={`${th} text-right`}>Lines</th>
                <th className={`${th} text-right`}>Not linked</th>
              </tr>
            </thead>
            {grouped.map(({ group, rows }) => (
              <tbody key={group}>
                <tr className="border-t border-[#D8E1F1] bg-[#FDFBF7]">
                  <td colSpan={7} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#46546F]">{GROUP_LABEL[group]}</td>
                </tr>
                {rows.map((s) => (
                  <tr
                    key={s.account_id}
                    onClick={() => pick(s.account_id)}
                    className={`cursor-pointer border-t border-[#EDF1F9] transition-colors hover:bg-[#F3F6FC] ${accountId === s.account_id ? "bg-[#EAF1FD]" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2 font-medium text-[#0F1B3D]"><Dot name={s.name} group={s.group} />{s.name}</span>
                    </td>
                    <td className={`${num} text-[#5E6B85]`}>{s.opening != null ? aed2(s.opening) : "—"}</td>
                    <td className={`${num} text-[#0F1B3D]`}>{s.debit ? aed2(s.debit) : "—"}</td>
                    <td className={`${num} text-[#0F1B3D]`}>{s.credit ? aed2(s.credit) : "—"}</td>
                    <td className={`${num} font-medium ${s.balance && Math.abs(s.balance) >= 1 && s.group === "clearing" ? "text-[#8A5A14]" : "text-[#0F1B3D]"}`}>
                      {s.balance != null ? aed2(s.balance) : "—"}
                    </td>
                    <td className={`${num} text-[#5E6B85]`}>{s.lineCount}</td>
                    <td className={`${num} ${s.unlinked ? "font-medium text-[#8A5A14]" : "text-[#97A3BA]"}`}>{s.group === "clearing" || s.group === "bank" ? s.unlinked || "0" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>

      {/* ── Lines ── */}
      <div ref={linesRef} className="scroll-mt-4 overflow-hidden rounded-2xl border border-[#D8E1F1] bg-white shadow-sm">
        <div className="flex flex-col gap-2.5 border-b border-[#D8E1F1] px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-[14.5px] font-semibold text-[#0F1B3D]">
              {selected ? selected.name : "All watched accounts"}
            </h3>
            <p className="text-[12.5px] text-[#5E6B85]">
              {filtered.length.toLocaleString()} of {scoped.length.toLocaleString()} lines · Search a reference, entry number, customer or exact amount.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={accountId}
              onChange={(e) => pick(e.target.value)}
              aria-label="Account"
              className="h-9 max-w-[220px] rounded-lg border-0 bg-white px-2.5 text-[12.5px] text-[#0F1B3D] ring-1 ring-inset ring-[#D8E1F1] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]"
            >
              <option value="all">All accounts</option>
              {grouped.flatMap((g) => g.rows).map((s) => <option key={s.account_id} value={s.account_id}>{s.name}</option>)}
            </select>
            <select
              value={type}
              onChange={(e) => { setType(e.target.value); setShown(PAGE); }}
              aria-label="Transaction type"
              className="h-9 rounded-lg border-0 bg-white px-2.5 text-[12.5px] text-[#0F1B3D] ring-1 ring-inset ring-[#D8E1F1] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]"
            >
              <option value="all">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#5E6B85]" aria-hidden />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }}
                placeholder="Ref, entry, payee, amount…"
                aria-label="Search ledger lines"
                className="h-9 w-56 rounded-lg border-0 bg-white pl-8 pr-7 text-[12.5px] text-[#0F1B3D] ring-1 ring-inset ring-[#D8E1F1] placeholder:text-[#97A3BA] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-[#5E6B85] hover:text-[#0F1B3D]"><X size={13} /></button>
              )}
            </label>
            <button
              onClick={() => { setOnlyUnlinked((v) => !v); setShown(PAGE); }}
              aria-pressed={onlyUnlinked}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium ring-1 ring-inset transition-colors ${onlyUnlinked ? "bg-[#0F1B3D] text-[#F3F6FC] ring-[#0F1B3D]" : "bg-white text-[#46546F] ring-[#D8E1F1] hover:bg-[#F3F6FC]"}`}
            >
              <CircleDashed size={13} aria-hidden /> Not linked only
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-[13px] text-[#5E6B85]">No lines match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-[#F3F6FC]">
                  <th className={`${th} text-left`}>Date</th>
                  {accountId === "all" && <th className={`${th} text-left`}>Account</th>}
                  <th className={`${th} text-left`}>Type</th>
                  <th className={`${th} text-left`}>Entry · Ref</th>
                  <th className={`${th} text-left`}>Payee · Description</th>
                  <th className={`${th} text-left`}>Offset account</th>
                  <th className={`${th} text-right`}>Debit</th>
                  <th className={`${th} text-right`}>Credit</th>
                  <th className={`${th} text-left`}>Omnia</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, shown).map((l) => {
                  const acct = byId.get(l.accountId);
                  return (
                    <tr key={l.id} className="border-t border-[#EDF1F9] align-top hover:bg-[#FDFBF7]">
                      <td className="whitespace-nowrap px-3 py-2 text-[#46546F]">{l.date ?? "—"}</td>
                      {accountId === "all" && (
                        <td className="px-3 py-2">
                          {acct && <span className="inline-flex items-center gap-1.5 text-[#0F1B3D]"><Dot name={acct.name} group={acct.group} />{acct.name}</span>}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-2 text-[#46546F]">{l.typeLabel || l.type}</td>
                      <td className="px-3 py-2">
                        <div className="font-mono text-[12px] text-[#0F1B3D]">{l.entry || "—"}</div>
                        {l.ref && <div className="font-mono text-[11px] text-[#5E6B85]">{l.ref}</div>}
                      </td>
                      <td className="max-w-[280px] px-3 py-2">
                        <div className="truncate text-[#0F1B3D]" title={l.payee}>{l.payee || "—"}</div>
                        {l.desc && <div className="truncate text-[11px] text-[#5E6B85]" title={l.desc}>{l.desc}</div>}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-[#46546F]" title={l.offset}>{l.offset || "—"}</td>
                      <td className={`${num} text-[#0F1B3D]`}>{l.debit ? aed2(l.debit) : ""}</td>
                      <td className={`${num} text-[#0F1B3D]`}>{l.credit ? aed2(l.credit) : ""}</td>
                      <td className="whitespace-nowrap px-3 py-2"><LinkBadge linked={l.linked} /></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#D8E1F1] bg-[#F3F6FC] font-medium">
                  <td colSpan={accountId === "all" ? 6 : 5} className="px-3 py-2 text-[12px] text-[#46546F]">Total of {filtered.length.toLocaleString()} filtered lines</td>
                  <td className={`${num} text-[#0F1B3D]`}>{aed2(foot.d)}</td>
                  <td className={`${num} text-[#0F1B3D]`}>{aed2(foot.c)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            {shown < filtered.length && (
              <div className="border-t border-[#D8E1F1] px-5 py-3 text-center">
                <button onClick={() => setShown((n) => n + PAGE * 5)} className="text-[12.5px] font-medium text-[#8A5A14] hover:underline">
                  Show more ({(filtered.length - shown).toLocaleString()} remaining)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
