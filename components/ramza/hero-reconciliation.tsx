"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { SCENARIOS, money } from "@/lib/ramza/scenarios";

/* The one orchestrated moment on the page. Real DOM, not a video, so it stays
   crisp and accessible. Transforms + opacity only. Pauses on hover and when the
   tab is hidden. prefers-reduced-motion renders scenario 1's final state. */

const STEP_DURATIONS = [900, 1400, 1000, 1200]; // 0->1, 1->2, 2->3, 3->4
const HOLD_BEFORE_SWAP = 2100; // step 4 hold, then crossfade

export function HeroReconciliation() {
  const reduce = useReducedMotion();
  const [si, setSi] = useState(0);
  const [step, setStep] = useState(reduce ? 4 : 0);

  const hoverRef = useRef(false);
  const pausedRef = useRef(false);
  const syncPaused = () => {
    pausedRef.current = hoverRef.current || (typeof document !== "undefined" && document.hidden);
  };

  useEffect(() => {
    const onVis = () => syncPaused();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (reduce) return;
    const advancing = step < 4;
    const delay = advancing ? STEP_DURATIONS[step] : HOLD_BEFORE_SWAP;
    let id: ReturnType<typeof setTimeout>;
    const run = () => {
      if (pausedRef.current) {
        id = setTimeout(run, 160);
        return;
      }
      if (advancing) setStep(step + 1);
      else {
        setStep(0);
        setSi((i) => (i + 1) % SCENARIOS.length);
      }
    };
    id = setTimeout(run, delay);
    return () => clearTimeout(id);
  }, [step, si, reduce]);

  const sc = SCENARIOS[si];
  const matched = step >= 2;
  const showCharges = step >= 3;
  const showClose = step >= 4;

  return (
    <div
      role="img"
      aria-label={sc.ariaLabel}
      onMouseEnter={() => {
        hoverRef.current = true;
        syncPaused();
      }}
      onMouseLeave={() => {
        hoverRef.current = false;
        syncPaused();
      }}
      className="r-glass w-full rounded-2xl p-4 sm:p-5"
      style={{ willChange: "auto" }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={sc.id}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* header */}
          <div className="flex items-center justify-between text-xs" style={{ color: "var(--ink-60)" }}>
            <span>{sc.gateway} payout</span>
            <span>{sc.currency}</span>
          </div>

          {/* bank credit row */}
          <div className="mt-3 flex items-center justify-between rounded-lg border r-hairline px-3 py-2.5">
            <div>
              <div className="text-[11px]" style={{ color: "var(--ink-60)" }}>
                Bank credit
              </div>
              <div className="tnum text-sm font-semibold" style={{ color: "var(--ink)" }}>
                AED {money(sc.bankCredit)}
              </div>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={matched ? "m" : "u"}
                initial={reduce ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: 4 }}
                transition={{ duration: 0.25 }}
                className={`r-pill ${matched ? "r-pill-matched" : "r-pill-unmatched"}`}
              >
                {matched ? "Matched" : "Unmatched"}
              </motion.span>
            </AnimatePresence>
          </div>

          {/* connector */}
          <motion.div
            aria-hidden
            initial={false}
            animate={{ scaleY: step >= 1 ? 1 : 0 }}
            transition={{ duration: 0.35 }}
            className="mx-auto my-1 h-4 w-px origin-top"
            style={{ background: matched ? "var(--ledger)" : "var(--rule)" }}
          />

          {/* payout file card */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: step >= 1 ? 1 : 0, y: step >= 1 ? 0 : 10 }}
            transition={{ duration: 0.4 }}
            className="rounded-lg border r-hairline p-2.5"
          >
            <div className="mb-1.5 text-[11px]" style={{ color: "var(--ink-60)" }}>
              {sc.gateway} payout file
            </div>
            <ul className="space-y-1">
              {sc.orders.map((o, i) => (
                <motion.li
                  key={o.ref}
                  initial={reduce ? false : { opacity: 0, x: -6 }}
                  animate={{ opacity: step >= 1 ? 1 : 0, x: step >= 1 ? 0 : -6 }}
                  transition={{ duration: 0.25, delay: reduce ? 0 : 0.15 + i * 0.04 }}
                  className="flex items-center justify-between text-xs"
                  style={{ color: "var(--ink)" }}
                >
                  <span style={{ color: "var(--ink-60)" }}>{o.ref}</span>
                  <span className="tnum">{money(o.amount)}</span>
                </motion.li>
              ))}
            </ul>
            <div className="mt-1.5 text-[11px]" style={{ color: "var(--ink-60)" }}>
              + {sc.moreCount} more orders
            </div>
          </motion.div>

          {/* fee + VAT + FX */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <motion.span
              initial={false}
              animate={{
                opacity: showCharges ? 1 : 0,
                y: showCharges ? 0 : -6,
              }}
              transition={{ duration: 0.3 }}
              className="r-pill"
              style={{
                background: "color-mix(in srgb, var(--residual) 16%, transparent)",
                color: "color-mix(in srgb, var(--residual) 82%, var(--ink))",
              }}
            >
              Bank charges {money(sc.fee)} + {money(sc.vatOnFee)} VAT
            </motion.span>
            {sc.fx && (
              <motion.span
                initial={false}
                animate={{ opacity: showCharges ? 1 : 0, y: showCharges ? 0 : -6 }}
                transition={{ duration: 0.3, delay: 0.08 }}
                className="r-pill"
                style={{
                  background: "color-mix(in srgb, var(--ink) 8%, transparent)",
                  color: "var(--ink-60)",
                }}
              >
                FX {sc.fx.note}
              </motion.span>
            )}
            {sc.heldBack && (
              <motion.span
                initial={false}
                animate={{ opacity: showCharges ? 1 : 0, y: showCharges ? 0 : -6 }}
                transition={{ duration: 0.3, delay: 0.12 }}
                className="r-pill"
                style={{
                  background: "color-mix(in srgb, var(--ink) 8%, transparent)",
                  color: "var(--ink-60)",
                }}
              >
                Held: {sc.heldBack.label} {money(sc.heldBack.amount)}
              </motion.span>
            )}
          </div>

          {/* close in Zoho */}
          <motion.div
            initial={false}
            animate={{ opacity: showClose ? 1 : 0 }}
            transition={{ duration: 0.35 }}
            className="mt-3 border-t r-hairline pt-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                <CountUp to={sc.invoicesClosed} run={showClose} /> invoices closed in Zoho
              </span>
              <span className="r-pill r-pill-matched">Paid</span>
            </div>
            <div className="mt-2 flex gap-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <motion.span
                  key={i}
                  initial={false}
                  animate={{ backgroundColor: showClose ? "var(--ledger)" : "var(--stamp)" }}
                  transition={{ duration: 0.3, delay: reduce ? 0 : i * 0.06 }}
                  className="h-1.5 flex-1 rounded-full"
                />
              ))}
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function CountUp({ to, run }: { to: number; run: boolean }) {
  const [n, setN] = useState(run ? to : 0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!run) {
      setN(0);
      return;
    }
    if (reduce) {
      setN(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const dur = 700;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setN(Math.round(eased * to));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, to, reduce]);
  return <span className="tnum">{n}</span>;
}
