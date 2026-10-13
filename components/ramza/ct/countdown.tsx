"use client";

/* Live countdown to the next e-invoicing milestone for large businesses
 * (revenue ≥ the rules.json threshold): the ASP appointment deadline, then
 * — once that has passed — the go-live date. Dates and penalty amounts come
 * from config/rules.json through EINV.
 *
 * The server can't know the visitor's "now", so the digits render as "--"
 * until mount, then tick every second — no hydration mismatch.
 *   <Countdown />                  compact card (hero)
 *   <Countdown variant="bar" />    one-line strip */

import { useEffect, useState } from "react";
import { splitCountdown } from "@/lib/ramza/ct-penalty";
import { EINV } from "@/lib/ramza/rules";

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const aed = (n: number) => `AED ${n.toLocaleString("en-US")}`;
/** 23:59:59 Dubai time (GST, UTC+4) on a YYYY-MM-DD day. */
const endOfDubaiDay = (d: string) => Date.parse(`${d}T23:59:59Z`) - 4 * 3600_000;

function nextMilestone(nowMs: number) {
  if (nowMs <= endOfDubaiDay(EINV.largeAspBy)) return { label: "Appoint an e-invoicing provider by", day: EINV.largeAspBy, dueMs: endOfDubaiDay(EINV.largeAspBy) };
  return { label: "E-invoicing goes live", day: EINV.largeGoLive, dueMs: endOfDubaiDay(EINV.largeGoLive) - 86_400_000 };
}

function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function Countdown({ variant = "card" }: { variant?: "card" | "bar" }) {
  const now = useNow();
  const m = nextMilestone(now ?? Date.now());
  const left = now == null ? null : splitCountdown(m.dueMs - now);
  const pad = (n: number | undefined) => (n == null ? "--" : String(n).padStart(2, "0"));

  if (variant === "bar") {
    return (
      <span className="tabular-nums">
        {left ? `${left.days}d ${pad(left.hours)}h ${pad(left.minutes)}m ${pad(left.seconds)}s` : "--d --h --m --s"}
      </span>
    );
  }

  const units: [string, number | undefined][] = [["Days", left?.days], ["Hrs", left?.hours], ["Min", left?.minutes], ["Sec", left?.seconds]];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-white/12 bg-black/35 px-4 py-3 backdrop-blur-md">
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#B3A6FF]">{m.label}</div>
        <div className="mt-0.5 text-[14px] text-white">{fmtDay(m.day)}</div>
      </div>
      <div className="flex gap-1.5" aria-live="off">
        {units.map(([label, v]) => (
          <div key={label} className="w-[52px] rounded-xl bg-white/[0.06] py-1.5 text-center ring-1 ring-white/10">
            <div className="text-[20px] font-medium leading-none tabular-nums text-white">{pad(v)}</div>
            <div className="mt-1 text-[9.5px] uppercase tracking-[0.14em] text-[#A19EA6]">{label}</div>
          </div>
        ))}
      </div>
      <p className="w-full text-[12.5px] leading-snug text-[#B8B6C0]">
        Late appointment: <b className="font-medium text-white">{aed(EINV.aspLateAedPerMonth)}</b> a month. Each invoice not sent as an e-invoice: <b className="font-medium text-white">{aed(EINV.perInvoiceAed)}</b>, up to {aed(EINV.invoiceCapAedPerMonth)} a month.
      </p>
    </div>
  );
}
