"use client";

/* Gradient hero band — the founder's first three seconds. Four glass cards
   (revenue, cash in, awaiting, COD) with animated count-ups, deltas vs the
   previous window, and a revenue sparkline. Every card opens its money
   drawer; filters live in the band so the whole page re-scopes from here. */

import { TrendingUp, TrendingDown, Landmark, Clock, Wallet, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Dash, MoneyDrawerKind } from "./types";
import { aed, compact } from "./types";

function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function Sparkline({ points, stroke }: { points: number[]; stroke: string }) {
  if (points.length < 2) return null;
  const W = 120, H = 30;
  const max = Math.max(...points, 1);
  const step = W / (points.length - 1);
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(H - (v / max) * (H - 4) - 2).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="hero-spark" aria-hidden>
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={stroke} opacity="0.15" />
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return null;
  const pct = ((now - before) / before) * 100;
  if (!isFinite(pct)) return null;
  const up = pct >= 0;
  return (
    <span className={`hero-delta ${up ? "up" : "down"}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {Math.abs(pct).toFixed(0)}% vs previous
    </span>
  );
}

export function HeroBand({ data, days, store, onDays, onStore, onOpenDrawer }: {
  data: Dash;
  days: number;
  store: string;
  onDays: (d: number) => void;
  onStore: (s: string) => void;
  onOpenDrawer: (k: MoneyDrawerKind) => void;
}) {
  const k = data.kpis;
  const revenue = useCountUp(k.revenue);
  const cash = useCountUp(k.bankCredits);
  const awaiting = useCountUp(k.awaitingPayout);
  const cod = useCountUp(k.codPendingAed);
  const trendTotals = data.trend.map((t) => t.total);

  const settledShare = k.bankCredits > 0 ? k.settled / k.bankCredits : 0;
  const codShare = k.revenue > 0 ? k.codPendingAed / k.revenue : 0;

  return (
    <section className="hero">
      <style>{HERO_CSS}</style>
      <div className="hero-glow one" /><div className="hero-glow two" />

      <div className="hero-top">
        <div>
          <p className="hero-eyebrow">Omnia · all stores live</p>
          <h1 className="hero-title">Today&apos;s business, at a glance</h1>
        </div>
        <div className="hero-filters">
          <div className="hero-pills">
            {[7, 30, 60, 90].map((d) => (
              <button key={d} className={days === d ? "on" : ""} onClick={() => onDays(d)}>{d}d</button>
            ))}
          </div>
          <div className="hero-pills">
            {["All", "WA", "UAE", "KSA", "WOO"].map((s) => (
              <button key={s} className={store === s ? "on" : ""} onClick={() => onStore(s)}>{s}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="hero-cards">
        <button className="hero-card" onClick={() => onOpenDrawer("revenue")}>
          <span className="hero-label"><TrendingUp size={13} /> Revenue · {days}d</span>
          <span className="hero-value">{aed(revenue)}</span>
          <Delta now={k.revenue} before={data.previous.revenue} />
          <Sparkline points={trendTotals} stroke="#7dd3fc" />
          <span className="hero-sub">{k.orders.toLocaleString()} orders · avg {aed(k.aov)} <ChevronRight size={12} className="hero-arrow" /></span>
        </button>

        <button className="hero-card" onClick={() => onOpenDrawer("cash")}>
          <span className="hero-label"><Landmark size={13} /> Cash into bank</span>
          <span className="hero-value green">{aed(cash)}</span>
          <span className="hero-meter"><i style={{ width: `${Math.min(settledShare * 100, 100)}%` }} /></span>
          <span className="hero-sub">{(settledShare * 100).toFixed(0)}% proven against payout files <ChevronRight size={12} className="hero-arrow" /></span>
        </button>

        <button className="hero-card" onClick={() => onOpenDrawer("awaiting")}>
          <span className="hero-label"><Clock size={13} /> Waiting to be explained</span>
          <span className="hero-value amber">{aed(awaiting)}</span>
          <span className="hero-meter amber"><i style={{ width: `${k.bankCredits > 0 ? Math.min((k.awaitingPayout / k.bankCredits) * 100, 100) : 0}%` }} /></span>
          <span className="hero-sub">bank credits missing their payout file <ChevronRight size={12} className="hero-arrow" /></span>
        </button>

        <button className="hero-card" onClick={() => onOpenDrawer("cod")}>
          <span className="hero-label"><Wallet size={13} /> Cash with couriers</span>
          <span className="hero-value pink">{aed(cod)}</span>
          <span className="hero-meter pink"><i style={{ width: `${Math.min(codShare * 100, 100)}%` }} /></span>
          <span className="hero-sub">{k.codPendingCount.toLocaleString()} COD orders not yet remitted <ChevronRight size={12} className="hero-arrow" /></span>
        </button>
      </div>
    </section>
  );
}

const HERO_CSS = `
  .hero { position: relative; overflow: hidden; border-radius: 24px; padding: 26px 28px 28px;
    background: linear-gradient(130deg, #1e1b4b 0%, #312e81 30%, #4c1d95 62%, #7c3aed 100%);
    color: #fff; box-shadow: 0 24px 60px -24px rgba(76, 29, 149, .55); }
  .hero * { box-sizing: border-box; }
  .hero-glow { position: absolute; border-radius: 50%; filter: blur(70px); pointer-events: none; }
  .hero-glow.one { width: 380px; height: 380px; background: rgba(168, 85, 247, .35); top: -160px; right: -80px; }
  .hero-glow.two { width: 300px; height: 300px; background: rgba(56, 189, 248, .22); bottom: -140px; left: 12%; }

  .hero-top { position: relative; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }
  .hero-eyebrow { margin: 0 0 6px; font-size: 10.5px; letter-spacing: .2em; text-transform: uppercase; color: rgba(255,255,255,.65); font-weight: 600; }
  .hero-title { margin: 0; font-family: Georgia, serif; font-weight: 500; font-size: 26px; letter-spacing: -.01em; }
  .hero-filters { display: flex; gap: 8px; flex-wrap: wrap; }
  .hero-pills { display: inline-flex; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.18); border-radius: 999px; padding: 3px; backdrop-filter: blur(8px); }
  .hero-pills button { border: 0; background: transparent; color: rgba(255,255,255,.75); font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 999px; cursor: pointer; transition: all .15s; }
  .hero-pills button.on { background: #fff; color: #312e81; box-shadow: 0 2px 8px rgba(0,0,0,.25); }

  .hero-cards { position: relative; display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  .hero-card { display: flex; flex-direction: column; align-items: flex-start; gap: 7px; text-align: left; cursor: pointer;
    background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.20); border-radius: 18px; padding: 16px 18px;
    backdrop-filter: blur(14px); color: #fff; transition: transform .18s ease, background .18s ease; }
  .hero-card:hover { transform: translateY(-3px); background: rgba(255,255,255,.16); }
  .hero-card:hover .hero-arrow { transform: translateX(3px); opacity: 1; }
  .hero-label { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: rgba(255,255,255,.72); }
  .hero-value { font-family: Georgia, serif; font-size: clamp(20px, 2.1vw, 27px); line-height: 1.1; }
  .hero-value.green { color: #6ee7b7; } .hero-value.amber { color: #fcd34d; } .hero-value.pink { color: #f9a8d4; }
  .hero-delta { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
  .hero-delta.up { background: rgba(52, 211, 153, .18); color: #6ee7b7; }
  .hero-delta.down { background: rgba(248, 113, 113, .18); color: #fca5a5; }
  .hero-spark { width: 100%; max-width: 150px; height: 30px; margin-top: 2px; }
  .hero-meter { width: 100%; max-width: 150px; height: 6px; border-radius: 999px; background: rgba(255,255,255,.15); overflow: hidden; margin-top: 6px; }
  .hero-meter i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #34d399, #6ee7b7); transition: width .6s ease; }
  .hero-meter.amber i { background: linear-gradient(90deg, #f59e0b, #fcd34d); }
  .hero-meter.pink i { background: linear-gradient(90deg, #ec4899, #f9a8d4); }
  .hero-sub { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: rgba(255,255,255,.6); margin-top: auto; }
  .hero-arrow { opacity: .4; transition: all .18s; }

  @media (max-width: 980px) { .hero-cards { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 560px) { .hero-cards { grid-template-columns: 1fr; } .hero-title { font-size: 21px; } }
`;
