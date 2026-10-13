"use client";

/* Transaction-based pricing counter. Everything comes from config/rules.json:
 *   billable txn = bank lines + ceil(gateway lines / gateway_lines_per_txn)
 *   → the first tier whose max_txn fits → its AED/month, or "Get a quote"
 *     while the founder hasn't set that tier's price (null)
 *   + the one-off late-filing rescue fee when the deadline was missed
 * The competitor anchor is shown for context only.
 *
 * "Get my quote" hands the result to the lead form (window event
 * "ramza:quote") and scrolls to it, so the accountant sees it on the lead. */

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { RESCUE_FEE_AED, billableTxn, priceForTxn, rules } from "@/lib/ramza/rules";
import { track } from "@/lib/ramza/track";
import { ct } from "./brand";
import { Reveal } from "./reveal";
import { TrackView } from "./tracked";

export type QuoteHandoff = { summary: string; billable: number; monthlyAed: number | null; rescue: boolean };
export const QUOTE_EVENT = "ramza:quote";

const fmt = (n: number) => n.toLocaleString("en-US");

function Slider({ label, value, onChange, max, hint }: { label: string; value: number; onChange: (v: number) => void; max: number; hint: string }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] font-medium text-[#14131C]">{label}</span>
        <span className="text-[18px] font-medium tabular-nums text-[#4F35E8]">{fmt(value)}</span>
      </div>
      <input type="range" min={0} max={max} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 w-full accent-[#4F35E8]" aria-label={label} />
      <span className="text-[12px] text-[#8E8B95]">{hint}</span>
    </label>
  );
}

export function PricingCounter() {
  const [bank, setBank] = useState(80);
  const [orders, setOrders] = useState(400);
  const [gateways, setGateways] = useState<string[]>(["Stripe", "Tabby", "Tamara"]);
  const [late, setLate] = useState(false);

  const gatewayLines = gateways.length ? orders : 0;
  const billable = useMemo(() => billableTxn(bank, gatewayLines), [bank, gatewayLines]);
  const monthly = priceForTxn(billable);
  const tierIdx = rules.pricing.tiers.findIndex((t) => billable <= t.max_txn);
  const anchor = rules.pricing.competitor_anchor;
  const perLine = rules.pricing.gateway_lines_per_txn;

  const getQuote = () => {
    const summary = `${fmt(billable)} billable txn/month (${fmt(bank)} bank lines + ${fmt(gatewayLines)} gateway lines via ${gateways.join(", ") || "no gateways"})${late ? ` · missed deadline → rescue AED ${fmt(RESCUE_FEE_AED ?? 0)}` : ""}`;
    const detail: QuoteHandoff = { summary, billable, monthlyAed: monthly, rescue: late };
    window.dispatchEvent(new CustomEvent(QUOTE_EVENT, { detail }));
    track("ViewContent", { content: "pricing-quote", billable });
    document.getElementById("start")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section id="pricing" className={`${ct.sectionLight} scroll-mt-24 pb-24 pt-24`}>
      <TrackView section="pricing" event="ViewContent" className={ct.container}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className={ct.eyebrow}>Transaction-based pricing</span>
          <h2 className={`${ct.h2} mt-4`}>Pay for what moves through your books</h2>
          <p className={`${ct.lead} mt-4`}>Gateway lines count {perLine} to 1 — so Stripe, Tabby, Tamara and Telr payouts don’t blow up your bill.</p>
        </Reveal>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Reveal className={`${ct.card} space-y-7`}>
            <Slider label="Bank lines a month" value={bank} onChange={setBank} max={600} hint="Every line on your bank statements" />
            <Slider label="Online orders a month" value={orders} onChange={setOrders} max={3000} hint={`Each order is a gateway line — ${perLine} of them bill as 1 transaction`} />
            <div>
              <span className="text-[14px] font-medium text-[#14131C]">Payment gateways</span>
              <div className="mt-3 flex flex-wrap gap-2">
                {rules.pricing.gateways.map((g) => {
                  const on = gateways.includes(g);
                  return (
                    <button key={g} type="button" onClick={() => setGateways((cur) => (on ? cur.filter((x) => x !== g) : [...cur, g]))}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] transition ${on ? "bg-[#14131C] text-white shadow-[0_8px_20px_-10px_rgba(79,53,232,0.8)]" : "bg-[#F1EFEA] text-[#55525E] hover:bg-[#E8E5DE]"}`}>
                      {on && <Check size={13} />}{g}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-[#FFF7ED] px-4 py-3.5 ring-1 ring-[#FED7AA]">
              <span className="text-[14px] text-[#7C2D12]"><b className="font-medium">Missed the filing deadline?</b> Add the one-off late-filing rescue.</span>
              <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${late ? "bg-[#EA580C]" : "bg-[#E5E7EB]"}`}>
                <motion.span className="absolute top-1 h-5 w-5 rounded-full bg-white shadow" animate={{ left: late ? 24 : 4 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
              </span>
              <input type="checkbox" className="sr-only" checked={late} onChange={(e) => setLate(e.target.checked)} />
            </label>
          </Reveal>

          <Reveal delay={0.1} className="flex flex-col rounded-[28px] bg-gradient-to-br from-[#14131C] to-[#25232E] p-6 text-white sm:p-8">
            <div className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#CBC3FF]">Your estimate</div>
            <div className="mt-4 flex items-baseline gap-2">
              <motion.span key={billable} initial={{ opacity: 0.4, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[46px] font-medium leading-none tabular-nums">{fmt(billable)}</motion.span>
              <span className="text-[14px] text-[#B8B6C0]">billable transactions / month</span>
            </div>
            <div className="mt-2 text-[13px] text-[#B8B6C0]">{fmt(bank)} bank + ⌈{fmt(gatewayLines)} ÷ {perLine}⌉ gateway</div>

            <div className="mt-6 rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
              <div className="flex items-center justify-between text-[14px]">
                <span>Monthly plan{tierIdx >= 0 ? ` · up to ${fmt(rules.pricing.tiers[tierIdx].max_txn)} txn` : ""}</span>
                <AnimatePresence mode="wait">
                  <motion.b key={String(monthly)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[18px] font-medium">
                    {monthly != null ? `AED ${fmt(monthly)}` : "Fixed quote"}
                  </motion.b>
                </AnimatePresence>
              </div>
              <AnimatePresence>
                {late && RESCUE_FEE_AED != null && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="mt-3 flex items-center justify-between border-t border-white/15 pt-3 text-[14px]">
                      <span>Late-filing rescue <span className="text-[#B8B6C0]">· one-off</span></span>
                      <b className="text-[18px] font-medium">AED {fmt(RESCUE_FEE_AED)}</b>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <p className="mb-7 mt-3 text-[12.5px] leading-relaxed text-[#B8B6C0]">
              For context: {anchor.name}s charge around AED {fmt(anchor.aed_month)}/month for {anchor.txn_included} transactions.
            </p>
            <button onClick={getQuote} className={`${ct.btnWhite} mt-auto w-full`}>
              Get my quote <ArrowRight size={16} />
            </button>
          </Reveal>
        </div>
      </TrackView>
    </section>
  );
}
