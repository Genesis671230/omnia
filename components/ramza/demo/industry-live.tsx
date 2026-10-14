"use client";

/* "Live" panel under the films — what the business looks like with RAMZA
 * plugged in, per industry. E-commerce: Shopify orders streaming in, stock
 * per warehouse and packaging boxes counting down, each order's money
 * following it to the bank. The others: COD by courier, a rent roll,
 * receivables aging, card terminals, progress certificates. Simulated,
 * labelled as a demo. */

import { AnimatePresence, motion, useInView } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { INDUSTRY_LABEL, type Industry } from "@/lib/ramza/demo/coa";
import { useIndustry, IndustryChips } from "./industry";

function useTick(ms: number, run: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run) return;
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms, run]);
  return n;
}

export function IndustryLive() {
  const { industry } = useIndustry();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.25 });
  return (
    <section id="live" className="relative py-20 sm:py-28">
      <div ref={ref} className="relative mx-auto w-full max-w-[1200px] px-5 sm:px-8">
        <div className="mx-auto max-w-[760px] text-center">
          <div className="inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[#4F35E8]">Built for your industry</div>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-[#14131C] sm:text-[44px]">{HEAD[industry]}</h2>
          <IndustryChips className="mt-6" from="industry_live" />
        </div>
        <div className="mt-10">
          <AnimatePresence mode="wait">
            <motion.div key={industry} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35 }}>
              {industry === "ecommerce" ? <EcomLive run={inView} /> : <Board industry={industry} run={inView} />}
            </motion.div>
          </AnimatePresence>
          <p className="mt-3 text-center text-[12px] text-[#A19EA6]">Simulated with demo data · {INDUSTRY_LABEL[industry]}</p>
        </div>
      </div>
    </section>
  );
}

const HEAD: Record<Industry, string> = {
  ecommerce: "Every Shopify order — stock, boxes and payout — tracked live.",
  logistics: "COD collected, remitted and owed — per courier, per merchant.",
  realestate: "Rent roll, cheques and service charges, always up to date.",
  wholesale: "Invoices, part-payments and aging without the chasing spreadsheet.",
  retail: "Card terminals, cash and Tabby — reconciled every morning.",
  construction: "Progress certificates, retention and WPS payroll in one place.",
};

const card = "rounded-[26px] bg-white ring-1 ring-[#E3E7F0] shadow-[0_24px_60px_-45px_rgba(20,19,28,0.35)]";

/* ── e-commerce ── */

const PRODUCTS = [
  { sku: "SET101", name: "Bridal set — Ciara", price: 2390, dxb: 14, ruh: 6, box: "Set box" },
  { sku: "BRC204", name: "Tennis bracelet", price: 640, dxb: 22, ruh: 9, box: "Bracelet box" },
  { sku: "EAR310", name: "Drop earrings", price: 380, dxb: 31, ruh: 12, box: "Earring box" },
  { sku: "RNG118", name: "Solitaire ring", price: 890, dxb: 18, ruh: 5, box: "Ring box" },
  { sku: "BAN407", name: "Bangle pair", price: 520, dxb: 12, ruh: 4, box: "Bangle box" },
  { sku: "PEN226", name: "Pendant — Hessa", price: 450, dxb: 25, ruh: 10, box: "Pendant box" },
];
const NAMES = ["Mariam A.", "Noura S.", "Aisha M.", "Hessa R.", "Reem J.", "Layla H.", "Dana T.", "Fatima K.", "Sara B.", "Amna F."];
const GWS = ["Shopify Payments", "Tabby", "Tamara", "Stripe", "COD"];
const STAGES = ["Paid", "Stock reserved", "Packed", "Shipped", "Payout in bank"] as const;

type Order = { id: string; who: string; sku: string; qty: number; store: "UAE" | "KSA"; gw: string; total: number; born: number };

function EcomLive({ run }: { run: boolean }) {
  const tick = useTick(1700, run);
  const orders = useMemo<Order[]>(() => Array.from({ length: tick }, (_, n) => {
    const p = PRODUCTS[(n * 7 + 3) % PRODUCTS.length];
    const qty = n % 9 === 0 ? 2 : 1;
    return { id: `#${4410 + n}`, who: NAMES[(n * 3) % NAMES.length], sku: p.sku, qty, store: n % 4 === 3 ? "KSA" : "UAE", gw: GWS[(n * 5 + 1) % GWS.length], total: p.price * qty, born: n };
  }), [tick]);
  const used = (sku: string, store: "UAE" | "KSA") => orders.filter((o) => o.sku === sku && o.store === store).reduce((a, o) => a + o.qty, 0);
  const boxes = PRODUCTS.map((p) => ({ name: p.box, left: 120 - orders.filter((o) => o.sku === p.sku).reduce((a, o) => a + o.qty, 0) - (p.sku === "SET101" ? 96 : 40) }));
  const sales = orders.reduce((a, o) => a + o.total, 0);
  const inBank = orders.filter((o) => tick - o.born >= 4).reduce((a, o) => a + o.total * 0.965, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
      <div className={`${card} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-[#EEF1F7] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#0B1533] text-[12px] font-bold text-white">S</span>
            <div><div className="text-[14px] font-semibold text-[#14131C]">Shopify · live orders</div><div className="text-[11.5px] text-[#8A8792]">UAE + KSA stores · synced every minute</div></div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1F9D63]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1F9D63]" />live</span>
        </div>
        <div className="h-[420px] space-y-2 overflow-hidden p-3">
          <AnimatePresence initial={false}>
            {[...orders].reverse().slice(0, 7).map((o) => {
              const stage = Math.min(tick - o.born, STAGES.length - 1);
              const p = PRODUCTS.find((x) => x.sku === o.sku)!;
              return (
                <motion.div key={o.id} layout initial={{ opacity: 0, y: -16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}
                  className="rounded-2xl bg-[#FFFFFF] px-3.5 py-2.5 ring-1 ring-[#EEF1F7]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium text-[#14131C]">{o.id} · {o.who} <span className="ml-1 rounded bg-white px-1.5 py-0.5 text-[10.5px] text-[#55525E] ring-1 ring-[#E3E7F0]">{o.store}</span></div>
                      <div className="truncate text-[11.5px] text-[#8A8792]">{o.qty}× {p.name} · {o.gw}</div>
                    </div>
                    <div className="text-right text-[13.5px] font-semibold tabular-nums text-[#14131C]">AED {o.total.toLocaleString("en-US")}</div>
                  </div>
                  <div className="mt-2 grid grid-cols-5 gap-1">
                    {STAGES.map((s, n) => <div key={s} title={s} className={`h-1 rounded-full transition-colors duration-500 ${n <= stage ? (n === 4 ? "bg-[#1F9D63]" : "bg-[#4F35E8]") : "bg-[#E3E7F0]"}`} />)}
                  </div>
                  <div className="mt-1 text-[10.5px] text-[#8A8792]">{STAGES[stage]}{stage === 2 ? ` · ${p.box} scanned` : stage === 4 ? ` · AED ${(o.total * 0.965).toFixed(2)} net` : ""}</div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {!orders.length && <div className="grid h-full place-items-center text-[13px] text-[#A19EA6]">Waiting for the first order…</div>}
        </div>
        <div className="grid grid-cols-3 border-t border-[#EEF1F7] text-center">
          {[["Orders today", String(orders.length)], ["Sales", `AED ${Math.round(sales).toLocaleString("en-US")}`], ["Already in bank", `AED ${Math.round(inBank).toLocaleString("en-US")}`]].map(([k, v]) => (
            <div key={k} className="px-2 py-3"><div className="text-[11px] text-[#8A8792]">{k}</div><div className="text-[15px] font-semibold tabular-nums text-[#14131C]">{v}</div></div>
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between"><div className="text-[14px] font-semibold text-[#14131C]">Stock by warehouse</div><div className="text-[11.5px] text-[#8A8792]">Dubai · Riyadh</div></div>
          <div className="mt-3 space-y-2.5">
            {PRODUCTS.map((p) => {
              const dxb = Math.max(p.dxb - used(p.sku, "UAE"), 0), ruh = Math.max(p.ruh - used(p.sku, "KSA"), 0);
              const low = dxb <= 3 || ruh <= 1;
              return (
                <div key={p.sku} className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[12.5px]"><span className="font-medium text-[#14131C]">{p.sku}</span><span className="truncate text-[#8A8792]">{p.name}</span>{low && <span className="rounded-full bg-[#FDECEF] px-1.5 py-0.5 text-[10px] font-medium text-[#B4233F]">low</span>}</div>
                    <div className="mt-1 grid grid-cols-[2fr_1fr] gap-1">
                      <div className="h-1.5 rounded-full bg-[#EEF1F7]"><motion.div className="h-full rounded-full bg-[#0B1533]" animate={{ width: `${(dxb / p.dxb) * 100}%` }} transition={{ duration: 0.6 }} /></div>
                      <div className="h-1.5 rounded-full bg-[#EEF1F7]"><motion.div className="h-full rounded-full bg-[#4F35E8]" animate={{ width: `${(ruh / p.ruh) * 100}%` }} transition={{ duration: 0.6 }} /></div>
                    </div>
                  </div>
                  <div className="w-16 text-right text-[12px] tabular-nums text-[#55525E]">{dxb} · {ruh}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between"><div className="text-[14px] font-semibold text-[#14131C]">Packaging boxes</div><div className="text-[11.5px] text-[#8A8792]">counted at the packing scan</div></div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {boxes.map((b) => (
              <motion.div key={b.name} layout className={`rounded-2xl px-3 py-2.5 ${b.left < 15 ? "bg-[#FDECEF]" : "bg-[#FFFFFF]"} ring-1 ring-[#EEF1F7]`}>
                <motion.div key={b.left} initial={{ scale: 1.25, color: "#4F35E8" }} animate={{ scale: 1, color: b.left < 15 ? "#B4233F" : "#14131C" }} className="font-[family-name:var(--font-display)] text-[22px] font-semibold tabular-nums">{Math.max(b.left, 0)}</motion.div>
                <div className="text-[11px] text-[#8A8792]">{b.name}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── other industries: one board, five live rows each ── */

type Row = { k: string; sub: string; base: number; step: number; unit?: string; status?: (n: number) => [string, "ok" | "warn" | "bad"] };
const BOARDS: Record<Exclude<Industry, "ecommerce">, { title: string; rows: Row[]; foot: (n: number) => [string, string][] }> = {
  logistics: {
    title: "COD by courier — today",
    rows: [
      { k: "Aramex", sub: "212 parcels · remitted", base: 41200, step: 940, status: (n) => [n % 5 === 4 ? "2 parcels short" : "matched", n % 5 === 4 ? "warn" : "ok"] },
      { k: "SMSA (KSA)", sub: "84 parcels · SAR → AED", base: 17800, step: 420, status: () => ["matched", "ok"] },
      { k: "Jeebly", sub: "61 parcels · awaiting remittance", base: 9200, step: 230, status: () => ["due Thu", "warn"] },
      { k: "Own drivers", sub: "cash handed in", base: 6400, step: 160, status: (n) => [n % 3 ? "counted" : "AED 120 short", n % 3 ? "ok" : "bad"] },
      { k: "Merchant payouts", sub: "owed to 14 merchants", base: 58400, step: 1100, status: () => ["Friday run", "ok"] },
    ],
    foot: (n) => [["COD collected", `AED ${(74600 + n * 1750).toLocaleString("en-US")}`], ["Still with couriers", `AED ${(12450 - Math.min(n * 300, 9000)).toLocaleString("en-US")}`], ["Fuel this week", "AED 8,900"]],
  },
  realestate: {
    title: "Rent roll — October",
    rows: [
      { k: "Unit 1204 — Al Mansoori", sub: "AED 23,500 · transfer", base: 23500, step: 0, status: () => ["paid", "ok"] },
      { k: "Villa 17 — Patel", sub: "cheque 4 of 4 · due 15 Oct", base: 37750, step: 0, status: (n) => [n > 3 ? "cleared" : "due tomorrow", n > 3 ? "ok" : "warn"] },
      { k: "Unit 905 — R. Khan", sub: "AED 18,000", base: 18000, step: 0, status: () => ["12 days overdue", "bad"] },
      { k: "Shop G03 — Café Lune", sub: "service charge Q4", base: 4200, step: 0, status: (n) => [n > 6 ? "paid by link" : "link sent", n > 6 ? "ok" : "warn"] },
      { k: "Security deposits", sub: "held in a separate account", base: 210000, step: 0, status: () => ["reconciled", "ok"] },
    ],
    foot: (n) => [["Collected", `AED ${(84700 + (n > 3 ? 37750 : 0) + (n > 6 ? 4200 : 0)).toLocaleString("en-US")}`], ["Overdue", "AED 18,000"], ["Cheques next 7 days", "AED 61,250"]],
  },
  wholesale: {
    title: "Receivables aging",
    rows: [
      { k: "Current", sub: "not yet due", base: 182400, step: 2600 },
      { k: "1–30 days", sub: "reminder sent automatically", base: 96300, step: -900 },
      { k: "31–60 days", sub: "statement emailed", base: 58600, step: -700 },
      { k: "Over 60 days", sub: "3 customers · call list", base: 48900, step: -300, status: () => ["chasing", "bad"] },
      { k: "Unapplied payments", sub: "matched to invoices by reference", base: 7250, step: -500, status: (n) => [n > 10 ? "all applied" : "applying", n > 10 ? "ok" : "warn"] },
    ],
    foot: (n) => [["Collected today", `AED ${(64000 + n * 3100).toLocaleString("en-US")}`], ["DSO", `${Math.max(38 - Math.floor(n / 4), 31)} days`], ["Customs + freight booked", "AED 24,000"]],
  },
  retail: {
    title: "Card terminals — today",
    rows: [
      { k: "Terminal 1 · Dubai Mall", sub: "Network International", base: 4210, step: 180, status: () => ["batch open", "ok"] },
      { k: "Terminal 2 · Dubai Mall", sub: "Network International", base: 2980, step: 140, status: () => ["batch open", "ok"] },
      { k: "Terminal 3 · Yas Mall", sub: "Network International", base: 1510, step: 90, status: () => ["batch open", "ok"] },
      { k: "Tabby in-store", sub: "pay in 4", base: 1100, step: 60, status: () => ["4.95% cost", "warn"] },
      { k: "Cash", sub: "matches the Z-report", base: 2140, step: 40, status: (n) => [n % 6 === 5 ? "AED 20 over" : "balanced", n % 6 === 5 ? "warn" : "ok"] },
    ],
    foot: (n) => [["Sales today", `AED ${(11940 + n * 510).toLocaleString("en-US")}`], ["Yesterday settled", "AED 9,412.70"], ["MDR + VAT booked", "AED 186.48"]],
  },
  construction: {
    title: "Projects — certificates & retention",
    rows: [
      { k: "Tower B — Emaar", sub: "IPC #7 · AED 420,000", base: 378000, step: 0, status: () => ["paid · 10% held", "ok"] },
      { k: "Villa — Al Furjan", sub: "IPC #3 · AED 186,000", base: 0, step: 0, status: (n) => [n > 5 ? "paid" : "certified", n > 5 ? "ok" : "warn"] },
      { k: "Retail pod — Nakheel", sub: "variation #2 pending", base: 0, step: 0, status: () => ["awaiting approval", "warn"] },
      { k: "Retention receivable", sub: "across 4 projects", base: 236568, step: 0, status: () => ["tracked", "ok"] },
      { k: "WPS payroll — October", sub: "24 staff · SIF ready", base: 188000, step: 0, status: (n) => [n > 8 ? "paid" : "ready to send", n > 8 ? "ok" : "warn"] },
    ],
    foot: () => [["Received this month", "AED 1,248,000"], ["Retention payable", "AED 61,200"], ["Gratuity provision", "AED 412,380"]],
  },
};

function Board({ industry, run }: { industry: Exclude<Industry, "ecommerce">; run: boolean }) {
  const n = useTick(1500, run);
  const b = BOARDS[industry];
  const tone = { ok: "bg-[#E6F6EE] text-[#147A4B]", warn: "bg-[#FFF4DB] text-[#9A6A00]", bad: "bg-[#FDECEF] text-[#B4233F]" };
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-[#EEF1F7] px-5 py-4">
        <div className="text-[15px] font-semibold text-[#14131C]">{b.title}</div>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1F9D63]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1F9D63]" />live</span>
      </div>
      <div className="divide-y divide-[#F3F1EC]">
        {b.rows.map((r, i) => {
          const v = Math.max(r.base + r.step * n, 0);
          const [label, t] = r.status?.(n) ?? ["on track", "ok"];
          return (
            <motion.div key={r.k} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.08 }} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3.5">
              <div className="min-w-0"><div className="truncate text-[14px] font-medium text-[#14131C]">{r.k}</div><div className="truncate text-[12px] text-[#8A8792]">{r.sub}</div></div>
              <motion.div key={v} initial={{ opacity: 0.4, y: -3 }} animate={{ opacity: 1, y: 0 }} className="text-right text-[14.5px] font-semibold tabular-nums text-[#14131C]">{v ? `AED ${v.toLocaleString("en-US")}` : "—"}</motion.div>
              <span className={`w-[132px] rounded-full px-2.5 py-1 text-center text-[11.5px] font-medium ${tone[t]}`}>{label}</span>
            </motion.div>
          );
        })}
      </div>
      <div className="grid grid-cols-3 border-t border-[#EEF1F7] bg-[#FFFFFF] text-center">
        {b.foot(n).map(([k, v]) => <div key={k} className="px-2 py-3.5"><div className="text-[11px] text-[#8A8792]">{k}</div><div className="text-[15px] font-semibold tabular-nums text-[#14131C]">{v}</div></div>)}
      </div>
    </div>
  );
}
