"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowDownToLine, BookOpen, CircleDashed, Coins, Landmark, Loader2, Percent,
  RefreshCcw, Repeat, TrendingUp,
} from "lucide-react";
import {
  dailyFlow, deductionsBySource, gatewayOf, ledgerTotals, summarizeAccounts,
  type LedgerAccountInfo, type LedgerLine,
} from "@/lib/reconciliation/ledger-insights";
import { AGING_COLORS, CHART_INK, gatewayColor } from "./colors";
import { LedgerExplorer, type ExplorerFocus } from "./ledger-explorer";
import { LedgerClosePanel } from "./ledger-close-panel";
import { closeFlags, gatewayRecon, type CloseFlag, type MissingFee, type OpenCreditNote, type StatementLine } from "@/lib/reconciliation/ledger-close";
import { aed0, aed2 } from "./types";
import { ZohoOrgPicker, useScreenZohoOrg, withZohoOrg } from "@/components/finance/zoho/org-picker";

/* The Ledger tab — the month in Zoho, without exporting the ledger.
 *
 * Data is a stored snapshot (lib/integrations/zoho-ledger.ts): opening the tab
 * costs zero Zoho calls; "Refresh from Zoho" spends ~60–80 and runs in the
 * background while the previous snapshot stays on screen. Every figure below
 * is computed client-side from the same lines the explorer lists, through the
 * pure functions in lib/reconciliation/ledger-insights.ts, so a tile and the
 * rows under it cannot disagree. */

type Snapshot = {
  month: string; status: string; started_at: string | null; finished_at: string | null;
  api_calls: number; line_count: number; accounts: LedgerAccountInfo[]; error: string | null;
  open_credit_notes?: OpenCreditNote[];
};
type Payload = {
  month: string; snapshot: Snapshot | null; lines: LedgerLine[]; statement?: StatementLine[]; missingFees?: MissingFee[];
  staleMapping: boolean; error?: string;
};

// Series here are flows, not gateways — so they must not borrow a gateway
// hue. Sales in primary ink, the two "money arriving" flows on the validated
// blue ramp (dark → light by how far along the money is).
const FLOW_COLORS = { sales: CHART_INK.primary, clearingIn: AGING_COLORS["8-14"], bankIn: AGING_COLORS["15+"] };
// Fee / VAT / FX are parts of one deduction, a magnitude split → one-hue ramp.
const DEDUCTION_COLORS = { fees: AGING_COLORS["15+"], vat: AGING_COLORS["8-14"], fxLoss: AGING_COLORS["0-7"] };

const tooltipStyle = {
  background: "#FFFFFF", border: "1px solid #D8E1F1", borderRadius: 10, fontSize: 12.5,
  padding: "8px 10px", boxShadow: "0 4px 16px rgba(15,27,61,0.08)",
};

function dubaiMonth(offset = 0) {
  const d = new Date(Date.now() + 4 * 3600_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
}
function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
function ago(iso: string | null) {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString("en-GB");
}
function monthEnd(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
}

function Tile({ label, value, note, icon: Icon, tone = "#0F1B3D" }: {
  label: string; value: string; note: string; icon: React.ElementType; tone?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#D8E1F1] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[12px] text-[#5E6B85]"><Icon size={13} className="text-[#1D4ED8]" aria-hidden /> {label}</div>
      <div className="mt-1.5 font-normal tracking-[-0.02em] text-[24px] tabular-nums" style={{ color: tone }}>{value}</div>
      <div className="mt-0.5 text-[11.5px] text-[#5E6B85]">{note}</div>
    </div>
  );
}

function Card({ title, subtitle, icon: Icon, children, empty }: {
  title: string; subtitle: string; icon: React.ElementType; children: React.ReactNode; empty?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#D8E1F1] bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <Icon size={15} className="text-[#1D4ED8]" aria-hidden />
        <h3 className="text-[14.5px] font-semibold text-[#0F1B3D]">{title}</h3>
      </div>
      <p className="mb-4 text-[12.5px] leading-relaxed text-[#5E6B85]">{subtitle}</p>
      {empty ? (
        <div className="flex h-[180px] items-center justify-center rounded-xl border border-dashed border-[#C9D5EA] px-6 text-center text-[13px] text-[#5E6B85]">{empty}</div>
      ) : children}
    </div>
  );
}

function Banner({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <div className={`flex items-start gap-2 rounded-xl px-4 py-3 text-[12.5px] ${tone === "error" ? "bg-[#F9ECE7] text-[#A6472F]" : "bg-[#EAF1FD] text-[#8A5A14]"}`}>
      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** `org` given = controlled by the page's Books selector (picker hidden). */
export function LedgerTab({ org: controlledOrg }: { org?: string } = {}) {
  const [month, setMonth] = useState(() => dubaiMonth());
  const [ownOrg, setOwnOrg] = useScreenZohoOrg("ledger");
  const org = controlledOrg ?? ownOrg;
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async (m: string) => {
    try {
      const res = await fetch(withZohoOrg(`/api/zoho/ledger?month=${m}`, org));
      const json = (await res.json()) as Payload;
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setData({ month: m, snapshot: null, lines: [], statement: [], staleMapping: false, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [org]);

  useEffect(() => { setLoading(true); setNotice(null); void load(month); }, [month, load]);

  const running = data?.snapshot?.status === "running";
  // Poll only while a snapshot runs; the lines stay on screen meanwhile.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(month), 4000);
    return () => clearInterval(t);
  }, [running, month, load]);

  const refresh = async (force: boolean) => {
    setStarting(true); setNotice(null);
    try {
      const res = await fetch(withZohoOrg("/api/zoho/ledger", org), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, force }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (!json.started) setNotice(json.reason ?? "Not started.");
      await load(month);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const snapshot = data?.snapshot ?? null;
  const lines = useMemo(() => data?.lines ?? [], [data]);
  const isCurrentMonth = month === dubaiMonth();
  const summaries = useMemo(
    () => summarizeAccounts(snapshot?.accounts ?? [], lines, { isCurrentMonth }),
    [snapshot, lines, isCurrentMonth],
  );
  const totals = useMemo(() => ledgerTotals(summaries), [summaries]);
  const daily = useMemo(() => dailyFlow(snapshot?.accounts ?? [], lines, { start: `${month}-01`, end: monthEnd(month) }), [snapshot, lines, month]);
  const deductions = useMemo(() => deductionsBySource(snapshot?.accounts ?? [], lines), [snapshot, lines]);
  const clearing = useMemo(
    () => summaries.filter((s) => s.group === "clearing" && (s.lineCount > 0 || (s.balance ?? 0) !== 0))
      .map((s) => ({ name: s.name, gateway: gatewayOf(s.name), balance: s.balance ?? 0, in: s.debit, out: s.credit }))
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
    [summaries],
  );
  const gateways = useMemo(() => gatewayRecon(summaries, lines), [summaries, lines]);
  const flags = useMemo(
    () => closeFlags({
      summaries, lines, statement: data?.statement ?? [],
      openCreditNotes: snapshot?.open_credit_notes ?? [], missingFees: data?.missingFees ?? [],
    }),
    [summaries, lines, data, snapshot],
  );
  const [focus, setFocus] = useState<ExplorerFocus | null>(null);
  const onFocus = useCallback((f: CloseFlag) => { if (f.focus) setFocus({ ...f.focus, nonce: Date.now() }); }, []);
  const hasLines = lines.length > 0;

  const months = [0, -1, -2, -3, -4, -5].map(dubaiMonth);

  return (
    <div className="space-y-4">
      {/* ── Header: month + snapshot state ── */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[#D8E1F1] bg-white px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <BookOpen size={18} className="text-[#1D4ED8]" aria-hidden />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-semibold text-[#0F1B3D]">Zoho ledger</h2>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                aria-label="Month"
                className="h-8 rounded-lg border-0 bg-[#F3F6FC] px-2 text-[13px] font-medium text-[#0F1B3D] ring-1 ring-inset ring-[#D8E1F1] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]"
              >
                {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
              {controlledOrg === undefined && <ZohoOrgPicker value={org} onChange={setOwnOrg} />}
            </div>
            <p className="text-[12px] text-[#5E6B85]">
              {running
                ? `Reading Zoho… ${snapshot?.api_calls ?? 0} calls so far. The previous snapshot stays on screen until it finishes.`
                : snapshot?.finished_at
                  ? `Snapshot ${ago(snapshot.finished_at)} · ${snapshot.line_count.toLocaleString()} lines from ${snapshot.accounts.length} accounts · ${snapshot.api_calls} Zoho calls`
                  : "No snapshot for this month yet."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {notice && <span className="text-[12px] text-[#8A5A14]">{notice}</span>}
          {notice?.includes("15 minutes") && (
            <button onClick={() => refresh(true)} className="text-[12px] font-medium text-[#8A5A14] underline">Refresh anyway</button>
          )}
          <button
            onClick={() => refresh(false)}
            disabled={running || starting}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#0F1B3D] px-3.5 text-[12.5px] font-medium text-[#F3F6FC] transition-colors hover:bg-[#3A332A] disabled:opacity-60"
          >
            {running || starting ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <RefreshCcw size={13} aria-hidden />}
            {running ? "Refreshing…" : "Refresh from Zoho"}
          </button>
        </div>
      </div>

      {data?.error && <Banner tone="error">Couldn&apos;t load the ledger: {data.error}</Banner>}
      {snapshot?.status === "failed" && <Banner tone="error">{snapshot.error ?? "The last refresh failed."}</Banner>}
      {snapshot?.status === "ready" && snapshot.error && <Banner tone="warn">{snapshot.error}</Banner>}
      {data?.staleMapping && (
        <Banner tone="warn">
          Settings → Zoho still maps the gateway clearing accounts to account IDs that don&apos;t exist in this Zoho organisation
          (they belong to another org). The ledger below reads the real accounts by name; fix the mapping before posting payouts from Settings.
        </Banner>
      )}

      {loading && !data ? (
        <div className="flex h-48 items-center justify-center text-[13px] text-[#5E6B85]"><Loader2 size={16} className="mr-2 animate-spin" /> Loading ledger…</div>
      ) : !hasLines && !running ? (
        <div className="rounded-2xl border border-dashed border-[#C9D5EA] bg-white px-6 py-12 text-center">
          <BookOpen size={22} className="mx-auto mb-2 text-[#1D4ED8]" aria-hidden />
          <div className="text-[14px] font-medium text-[#0F1B3D]">No ledger snapshot for {monthLabel(month)}</div>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-[#5E6B85]">
            A snapshot reads every gateway clearing account, the banks, Sales, VAT, fees and FX for the month —
            about 60–80 Zoho calls, a few minutes in the background. After that, this tab costs nothing to open.
          </p>
          <button
            onClick={() => refresh(true)}
            disabled={starting}
            className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#0F1B3D] px-4 text-[12.5px] font-medium text-white hover:bg-[#1E3A8A] disabled:opacity-60"
          >
            {starting ? <Loader2 size={13} className="animate-spin" /> : <ArrowDownToLine size={13} />} Take snapshot
          </button>
        </div>
      ) : (
        <>
          {/* ── Headline tiles ── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Tile label="Sales booked" value={aed0(totals.sales)} note="Sales account, net of reversals" icon={TrendingUp} />
            <Tile label="Into clearing" value={aed0(totals.clearingIn)} note="Customer payments landed on gateways" icon={Coins} />
            <Tile label="Out of clearing" value={aed0(totals.clearingOut)} note="Settled to bank, fees, refunds" icon={Landmark} />
            <Tile
              label="Still in clearing" value={aed0(totals.openClearing)}
              note={isCurrentMonth ? "Live Zoho balance, all gateways" : "Live balance (today)"}
              icon={AlertTriangle} tone={Math.abs(totals.openClearing) >= 1 ? "#8A5A14" : "#0F1B3D"}
            />
            <Tile label="Gateway fees + VAT" value={aed0(totals.fees + totals.inputVat)} note={`${aed0(totals.fees)} fees · ${aed0(totals.inputVat)} input VAT`} icon={Percent} />
            <Tile
              label="Not linked to Omnia" value={totals.unlinked.toLocaleString()}
              note="Clearing & bank lines with no payout or bank match"
              icon={CircleDashed} tone={totals.unlinked ? "#8A5A14" : "#4B7A54"}
            />
          </div>

          {/* ── Month-end close: the part the accountant acts on ── */}
          <LedgerClosePanel month={month} gateways={gateways} flags={flags} totals={totals} onFocus={onFocus} />

          {/* ── Daily flow ── */}
          <Card
            title="Daily money flow"
            subtitle="What was invoiced as sales each day against what reached the gateway clearing accounts and the bank. A gap that keeps widening is money booked as sold but not yet collected."
            icon={TrendingUp}
          >
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={daily} margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
                <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
                <XAxis dataKey="label" stroke={CHART_INK.axis} tick={{ fontSize: 11, fill: CHART_INK.muted }} interval="preserveStartEnd" />
                <YAxis tickFormatter={aed0} stroke={CHART_INK.axis} tick={{ fontSize: 11, fill: CHART_INK.muted }} width={78} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => `${d} ${monthLabel(month)}`} formatter={(v: number, n: string) => [aed2(v), n]} />
                <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }} />
                <Line type="monotone" dataKey="sales" name="Sales booked" stroke={FLOW_COLORS.sales} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="clearingIn" name="Into clearing" stroke={FLOW_COLORS.clearingIn} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="bankIn" name="Into bank" stroke={FLOW_COLORS.bankIn} strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ── Clearing balances ── */}
            <Card
              title="What's still sitting in each gateway"
              subtitle="Live Zoho balance of every clearing account. After a payout is fully booked (payment, fee, VAT, FX) it should return to zero — whatever remains is unsettled or mis-booked."
              icon={Coins}
              empty={clearing.length === 0 ? "No clearing activity this month." : undefined}
            >
              <ResponsiveContainer width="100%" height={Math.max(180, clearing.length * 34)}>
                <BarChart data={clearing} layout="vertical" margin={{ left: 4, right: 88, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke={CHART_INK.grid} />
                  <XAxis type="number" tickFormatter={aed0} stroke={CHART_INK.axis} tick={{ fontSize: 11, fill: CHART_INK.muted }} />
                  <YAxis type="category" dataKey="name" width={140} stroke={CHART_INK.axis} tick={{ fontSize: 11.5, fill: CHART_INK.secondary }} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number, _n, p: { payload?: { in: number; out: number } }) =>
                      [`${aed2(v)} · in ${aed0(p?.payload?.in ?? 0)} / out ${aed0(p?.payload?.out ?? 0)} this month`, "Balance"]}
                  />
                  <Bar dataKey="balance" radius={[0, 4, 4, 0]} barSize={16}>
                    {clearing.map((c) => <Cell key={c.name} fill={gatewayColor(c.gateway)} />)}
                    <LabelList dataKey="balance" position="right" formatter={aed0} style={{ fontSize: 11, fill: CHART_INK.secondary, fontWeight: 500 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* ── Deductions ── */}
            <Card
              title="Fees, VAT and exchange by gateway"
              subtitle="Everything booked against the gateways this month, attributed to the clearing account it went through. Exchange is shown as a loss (positive) or gain (negative)."
              icon={Repeat}
              empty={deductions.length === 0 ? "No fee, VAT or exchange entries this month." : undefined}
            >
              <ResponsiveContainer width="100%" height={Math.max(180, deductions.length * 38)}>
                <BarChart data={deductions} layout="vertical" margin={{ left: 4, right: 80, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke={CHART_INK.grid} />
                  <XAxis type="number" tickFormatter={aed0} stroke={CHART_INK.axis} tick={{ fontSize: 11, fill: CHART_INK.muted }} />
                  <YAxis type="category" dataKey="source" width={140} stroke={CHART_INK.axis} tick={{ fontSize: 11.5, fill: CHART_INK.secondary }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [aed2(v), n]} />
                  <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }} />
                  <Bar dataKey="fees" name="Fees" stackId="d" fill={DEDUCTION_COLORS.fees} barSize={16} />
                  <Bar dataKey="vat" name="VAT on fees" stackId="d" fill={DEDUCTION_COLORS.vat} barSize={16} />
                  <Bar dataKey="fxLoss" name="Exchange" stackId="d" fill={DEDUCTION_COLORS.fxLoss} barSize={16} radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="total" position="right" formatter={aed0} style={{ fontSize: 11, fill: CHART_INK.secondary, fontWeight: 500 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {totals.fxNet !== 0 && (
                <p className="mt-2 text-[12px] text-[#46546F]">
                  Net exchange this month: <span className="font-medium text-[#0F1B3D]">{aed2(totals.fxNet)}</span> {totals.fxNet >= 0 ? "gain" : "loss"}.
                </p>
              )}
            </Card>
          </div>

          <LedgerExplorer summaries={summaries} lines={lines} isCurrentMonth={isCurrentMonth} focus={focus} />
        </>
      )}
    </div>
  );
}
