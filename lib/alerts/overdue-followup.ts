// Overdue-payment follow-up text for the Telegram CFO bot and the daily call.
// Pure: hand it the admin money rows, get the message. What counts as overdue
// (gateway's usual days + grace) lives in lib/dashboard/admin-money.

import type { OrderMoney, OverdueGroup } from "@/lib/dashboard/admin-money";
import type { LedgerStatus } from "@/lib/orders/sales-ledger";

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** What to actually do, by where the money is stuck. */
const NEXT_STEP: Partial<Record<LedgerStatus, string>> = {
  no_payout_file: "no payout file yet — pull it from the gateway portal or check the sync",
  awaiting_payout: "charged but no payout issued — ask the gateway when it pays out",
  awaiting_bank: "payout issued, not in the bank — ask for the transfer reference and check the bank",
  in_review: "bank credit found but unconfirmed — confirm it in Reconciliation",
  cod: "cash on delivery — ask the courier for the remittance",
};

export function stuckAt(orders: OrderMoney[]): { stage: LedgerStatus; orders: number; amount: number }[] {
  const m = new Map<LedgerStatus, { stage: LedgerStatus; orders: number; amount: number }>();
  for (const o of orders) {
    const s = m.get(o.stage) ?? { stage: o.stage, orders: 0, amount: 0 };
    s.orders += 1;
    s.amount += o.awaiting;
    m.set(o.stage, s);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}

export function overdueMessage(day: string, groups: OverdueGroup[], orders: OrderMoney[], pendingTotal: number): string | null {
  if (!groups.length) return null;
  const overdue = orders.filter((o) => o.status === "overdue");
  const total = groups.reduce((a, g) => a + g.amount, 0);
  const lines = [
    `⏰ <b>Overdue payments · ${short(day)}</b>`,
    `AED ${n0(total)} overdue across ${overdue.length} orders (all pending: AED ${n0(pendingTotal)}).`,
    "",
  ];
  for (const g of groups) {
    const mine = overdue.filter((o) => o.gateway === g.gateway);
    const top = stuckAt(mine)[0];
    lines.push(`• <b>${esc(g.gateway)}</b> AED ${n0(g.amount)} · ${g.orders} orders · oldest ${esc(g.oldestOrder)} (${short(g.oldestDay)}, ${g.oldestDays} days; usual ${g.expectedDays})`);
    if (top && NEXT_STEP[top.stage]) lines.push(`   ↳ ${top.orders === g.orders ? "" : `${top.orders} of them: `}${NEXT_STEP[top.stage]}`);
  }
  lines.push("", "Details: dashboard → Admin → Payment gateways.");
  return lines.join("\n");
}

/** Plain sentences for a text-to-speech call — no markup, rounded amounts. */
export function overdueCallScript(groups: OverdueGroup[]): string {
  const total = groups.reduce((a, g) => a + g.amount, 0);
  const parts = groups.slice(0, 4).map((g) => `${g.gateway}: ${n0(g.amount)} dirhams across ${g.orders} orders, the oldest waiting ${g.oldestDays} days.`);
  return [
    `Hello, this is the Omnia CFO assistant with today's payment follow-up.`,
    `${n0(total)} dirhams of gateway payments are overdue.`,
    ...parts,
    `The full list is in the Telegram group and on the Admin dashboard. Please follow up today. Goodbye.`,
  ].join(" ");
}
