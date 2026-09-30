"use client";

/* Live countdown to the next Corporate Tax filing deadline for 31 December
 * year ends (lib/ramza/ct-penalty.ts → nextDecYearEndDeadline).
 *
 * The server can't know the visitor's "now", so the digits render as "--"
 * until mount, then tick every second — no hydration mismatch.
 *   <Countdown />                  full card (hero)
 *   <Countdown variant="bar" />    one-line strip (top bar) */

import { useEffect, useState } from "react";
import { nextDecYearEndDeadline, splitCountdown } from "@/lib/ramza/ct-penalty";

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

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
  const dl = nextDecYearEndDeadline(now ?? Date.now());
  const left = now == null ? null : splitCountdown(dl.dueMs - now);
  const pad = (n: number | undefined) => (n == null ? "--" : String(n).padStart(2, "0"));

  if (variant === "bar") {
    return (
      <span className="tabular-nums">
        {left ? `${left.days}d ${pad(left.hours)}h ${pad(left.minutes)}m ${pad(left.seconds)}s` : "--d --h --m --s"}
      </span>
    );
  }

  const units: [string, number | undefined][] = [["Days", left?.days], ["Hours", left?.hours], ["Minutes", left?.minutes], ["Seconds", left?.seconds]];
  return (
    <div className="rounded-[26px] border border-white/15 bg-white/[0.07] p-5 backdrop-blur-xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#8FB0FF]">Time left to file</span>
        <span className="text-[12.5px] text-[#B9C6EE]">{fmtDay(dl.yearEnd)} year end · due {fmtDay(dl.due)}</span>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {units.map(([label, v]) => (
          <div key={label} className="rounded-2xl bg-[#050D2B]/70 px-2 py-3 text-center ring-1 ring-white/10">
            <div className="text-[30px] font-medium leading-none tracking-[-0.02em] text-white tabular-nums sm:text-[36px]">{pad(v)}</div>
            <div className="mt-1.5 text-[11px] uppercase tracking-[0.12em] text-[#8FA3D9]">{label}</div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-[#B9C6EE]">
        Every month you’re late costs <b className="font-medium text-white">AED 500</b>, then <b className="font-medium text-white">AED 1,000</b> after a year. Unpaid tax adds <b className="font-medium text-white">14% a year</b> on top.
      </p>
    </div>
  );
}
