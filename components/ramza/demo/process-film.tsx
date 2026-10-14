"use client";

/* "How RAMZA closes your books" — a self-playing app window in four scenes:
 *   1 Collect  payouts pulled from Stripe / Shopify Payments APIs, Tabby &
 *              Tamara reports, the bank feed
 *   2 Match    payout lines snap onto invoices; fees + VAT split, FX converted
 *   3 Book     the journal lands in Zoho / Xero / QuickBooks, clearing at zero
 *   4 Close    the day closes; exceptions go to a person, the rest is done
 * Demo data only — a picture of the product, never a customer's numbers.
 * Click a scene to hold it; it moves on by itself otherwise. */

import { AnimatePresence, motion, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { funnel } from "@/lib/ramza/funnel";

const SCENES = [
  { k: "collect", t: "Collect", d: "Payouts pulled straight from Stripe and Shopify Payments, Tabby and Tamara reports read from your inbox, the bank feed synced." },
  { k: "match", t: "Match", d: "Every payout line lands on its invoice. Fees and VAT on fees split out, SAR / USD / KWD converted at the rate the bank actually paid." },
  { k: "book", t: "Book", d: "One clean journal per payout posted to Zoho Books, Xero or QuickBooks — the gateway clearing account back to zero." },
  { k: "close", t: "Close", d: "The day closes itself. The few exceptions — short payments, missing payouts — go to an accountant with the evidence attached." },
] as const;

export function ProcessFilm() {
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  useEffect(() => {
    if (!inView || held) return;
    const t = setTimeout(() => setI((x) => (x + 1) % SCENES.length), 5200);
    return () => clearTimeout(t);
  }, [i, inView, held]);
  useEffect(() => { if (inView) funnel("section_view", { section: "process_film" }); }, [inView]);

  return (
    <section id="how" className="relative py-20 sm:py-28">
      <div className="relative mx-auto w-full max-w-[1200px] px-5 sm:px-8">
        <div className="mx-auto max-w-[720px] text-center">
          <div className="inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[#4F35E8]">How it works</div>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-[#14131C] sm:text-[44px]">From payout to closed books, without a spreadsheet.</h2>
        </div>
        <div ref={ref} className="mt-12 grid gap-6 lg:grid-cols-[0.8fr_1.4fr] lg:items-center">
          <ol className="space-y-2">
            {SCENES.map((s, n) => (
              <li key={s.k}>
                <button onClick={() => { setI(n); setHeld(true); funnel("film_scene", { scene: s.k }); }} className={`relative w-full overflow-hidden rounded-[22px] p-5 text-left transition ${i === n ? "bg-white shadow-[0_20px_50px_-35px_rgba(20,19,28,0.45)] ring-1 ring-[#E3E7F0]" : "hover:bg-white/60"}`}>
                  <div className="flex items-center gap-3">
                    <span className={`font-[family-name:var(--font-display)] text-[13px] font-semibold tabular-nums ${i === n ? "text-[#4F35E8]" : "text-[#A19EA6]"}`}>0{n + 1}</span>
                    <span className={`text-[18px] font-semibold ${i === n ? "text-[#14131C]" : "text-[#8A8792]"}`}>{s.t}</span>
                  </div>
                  <AnimatePresence initial={false}>
                    {i === n && <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-2 pl-9 text-[14.5px] leading-relaxed text-[#55525E]">{s.d}</motion.p>}
                  </AnimatePresence>
                  {i === n && !held && <motion.div key={`bar-${i}`} className="absolute bottom-0 left-0 h-[3px] bg-[#4F35E8]" initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: 5.2, ease: "linear" }} />}
                </button>
              </li>
            ))}
          </ol>

          <div className="relative overflow-hidden rounded-[30px] bg-[#0B1533] p-2 shadow-[0_40px_80px_-40px_rgba(20,19,28,0.6)]">
            <div className="flex items-center gap-1.5 px-3 py-2.5">
              {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />)}
              <span className="ml-3 text-[12px] text-white/45">app.ramza · Reconciliation · October</span>
            </div>
            <div className="relative h-[430px] overflow-hidden rounded-[22px] bg-[#FFFFFF] sm:h-[460px]">
              <AnimatePresence mode="wait">
                <motion.div key={SCENES[i].k} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }} className="absolute inset-0 p-5">
                  {i === 0 && <Collect />}
                  {i === 1 && <Match />}
                  {i === 2 && <Book />}
                  {i === 3 && <Close />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const panel = "rounded-2xl bg-white ring-1 ring-[#E3E7F0]";

function Collect() {
  const src = [
    { n: "Stripe", how: "API · payouts + balance txns", c: 38, logo: "/ramza/logos/stripe-mark.png" },
    { n: "Shopify Payments", how: "API · payouts", c: 52 },
    { n: "Tabby", how: "Settlement report · email", c: 41, logo: "/ramza/logos/tabby-mark.png" },
    { n: "Tamara", how: "Settlement report · email", c: 17, logo: "/ramza/logos/tamara-mark.png" },
    { n: "Telr", how: "Transaction export", c: 12, logo: "/ramza/logos/telr-mark.png" },
    { n: "Bank feed", how: "Statement · daily", c: 63 },
  ];
  return (
    <div className="grid h-full grid-cols-2 gap-3 sm:grid-cols-3">
      {src.map((s, n) => (
        <motion.div key={s.n} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: n * 0.12 }} className={`${panel} flex flex-col justify-between p-4`}>
          <div className="flex items-center gap-2">
            {s.logo
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={s.logo} alt="" className="h-7 w-7 rounded-lg object-contain" />
              : <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#0B1533] text-[11px] font-bold text-white">{s.n[0]}</span>}
            <div className="text-[13.5px] font-semibold text-[#14131C]">{s.n}</div>
          </div>
          <div className="text-[11.5px] text-[#8A8792]">{s.how}</div>
          <div className="flex items-end justify-between">
            <motion.span className="font-[family-name:var(--font-display)] text-[26px] font-semibold tabular-nums text-[#14131C]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 + n * 0.12 }}>{s.c}</motion.span>
            <span className="text-[11px] text-[#8A8792]">lines in</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[#EEF1F7]"><motion.div className="h-full bg-[#4F35E8]" initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ delay: 0.2 + n * 0.12, duration: 1.2 }} /></div>
        </motion.div>
      ))}
    </div>
  );
}

function Match() {
  const pairs = [
    ["TABBY · SB1047", "INV SB1047", "1,280.00", "57.60 + 2.88"],
    ["STRIPE · SB1052 · USD", "INV SB1052", "2,203.50", "64.90"],
    ["SHOPIFY · SB1055", "INV SB1055", "940.00", "28.26 + 1.41"],
    ["TABBY · SA1061 · SAR", "INV SA1061", "1,615.84", "73.71 + 3.69"],
    ["TAMARA · SB1063", "INV SB1063", "2,390.00", "119.50 + 5.98"],
  ];
  return (
    <div className="grid h-full grid-cols-[1fr_auto_1fr] items-start gap-3">
      <div className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#8A8792]">Payout lines</div>
        {pairs.map((p, n) => <motion.div key={p[0]} initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: n * 0.35 }} className={`${panel} px-3 py-2.5 text-[12px] font-medium text-[#14131C]`}>{p[0]}<div className="text-[11px] font-normal text-[#8A8792]">fee {p[3]}</div></motion.div>)}
      </div>
      <div className="flex h-full flex-col gap-2 pt-6">
        {pairs.map((p, n) => (
          <motion.div key={p[0]} className="flex h-[52px] items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 + n * 0.35 }}>
            <motion.div className="h-[2px] bg-[#4F35E8]" initial={{ width: 0 }} animate={{ width: 46 }} transition={{ delay: 0.25 + n * 0.35, duration: 0.3 }} />
          </motion.div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#8A8792]">Invoices</div>
        {pairs.map((p, n) => (
          <motion.div key={p[1]} initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.15 + n * 0.35 }} className={`${panel} flex items-center justify-between px-3 py-2.5 text-[12px] text-[#14131C]`}>
            <div className="font-medium">{p[1]}<div className="text-[11px] font-normal text-[#8A8792]">AED {p[2]}</div></div>
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5 + n * 0.35, type: "spring" }} className="rounded-full bg-[#E6F6EE] px-2 py-0.5 text-[10.5px] font-semibold text-[#147A4B]">cleared</motion.span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function Book() {
  const lines = [["Bank — Emirates NBD", "18,240.55", ""], ["Payment processing fees", "820.80", ""], ["VAT input (recoverable)", "41.04", ""], ["Exchange loss", "12.40", ""], ["Gateway clearing — Tabby", "", "19,114.79"]];
  return (
    <div className="flex h-full flex-col gap-3">
      <div className={`${panel} flex items-center justify-between px-4 py-3`}>
        <div><div className="text-[13.5px] font-semibold text-[#14131C]">Journal · Tabby payout TBY-1043</div><div className="text-[11.5px] text-[#8A8792]">41 orders · 2 SAR · posted 14 Oct 09:02</div></div>
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ramza/logos/zoho-mark.png" alt="" className="h-6 w-auto rounded" />
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }} className="rounded-full bg-[#E6F6EE] px-2.5 py-1 text-[11px] font-semibold text-[#147A4B]">Posted ✓</motion.span>
        </div>
      </div>
      <div className={`${panel} flex-1 overflow-hidden`}>
        <div className="grid grid-cols-[1fr_90px_90px] border-b border-[#F3F1EC] px-4 py-2 text-[10.5px] uppercase tracking-[0.1em] text-[#8A8792]"><span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span></div>
        {lines.map((l, n) => (
          <motion.div key={l[0]} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + n * 0.28 }} className="grid grid-cols-[1fr_90px_90px] px-4 py-2.5 text-[13px] text-[#14131C]">
            <span className={l[2] ? "pl-5" : ""}>{l[0]}</span><span className="text-right tabular-nums">{l[1]}</span><span className="text-right tabular-nums">{l[2]}</span>
          </motion.div>
        ))}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8 }} className="mx-4 mt-1 flex items-center justify-between rounded-xl bg-[#F4F2FF] px-3 py-2 text-[12px] text-[#4F35E8]"><span>Clearing account balance</span><b>AED 0.00</b></motion.div>
      </div>
    </div>
  );
}

function Close() {
  const items = [["Payouts matched", "38 / 38"], ["Invoices cleared", "59 / 64"], ["Fees booked", "AED 2,944.96"], ["VAT on fees", "AED 138.82"], ["FX difference", "AED 70.59"]];
  return (
    <div className="grid h-full gap-3 sm:grid-cols-[1.1fr_1fr]">
      <div className={`${panel} p-4`}>
        <div className="text-[13.5px] font-semibold text-[#14131C]">Daily close · 14 Oct</div>
        <div className="mt-3 space-y-2">
          {items.map(([k, v], n) => (
            <motion.div key={k} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: n * 0.2 }} className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-2 text-[#55525E]"><span className="text-[#1F9D63]">✓</span>{k}</span><b className="tabular-nums text-[#14131C]">{v}</b>
            </motion.div>
          ))}
        </div>
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="mt-4 rounded-xl bg-[#0B1533] px-3 py-2.5 text-[12.5px] text-white">Books closed for 14 Oct — 2 min after the last payout landed.</motion.div>
      </div>
      <div className={`${panel} p-4`}>
        <div className="text-[13.5px] font-semibold text-[#14131C]">For a person to check</div>
        {[["SB1071 short-paid", "AED 412 less than the invoice — Tamara partial capture"], ["Shopify payout 14 Oct", "not in the bank yet — expected tomorrow"], ["Refund SB1012", "credit note raised, refund in the next payout"]].map(([t, d], n) => (
          <motion.div key={t} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 + n * 0.25 }} className="mt-2.5 rounded-xl bg-[#FFF8E8] p-2.5">
            <div className="text-[12.5px] font-medium text-[#7A5600]">{t}</div><div className="text-[11.5px] text-[#9A7A3A]">{d}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
