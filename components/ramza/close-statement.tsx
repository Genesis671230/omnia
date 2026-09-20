"use client";

import { motion, useReducedMotion } from "framer-motion";
import { CLOSE_STATEMENT } from "@/lib/ramza/copy";

/* The hero's right-hand frame: a real close, stated as a statement.
 *
 * What used to sit here cycled synthetic payouts with "Matched" and
 * "Awaiting" badges. Two problems with that. Every competitor's hero shows a
 * matched/unmatched state, so it differentiated nothing; and it was invented,
 * which is the one thing a finance buyer will test first.
 *
 * These are our own posted books. The figures come from the production
 * reconciliation database and the arithmetic resolves in public:
 * gross − fees − exchange differences = what the bank actually credited.
 * A page that shows its own numbers adding up is making the product's
 * argument rather than describing it.
 *
 * The line that does the work is "Clearing balance 0.00". Anyone who has
 * closed a month against a gateway knows what it costs to get that to zero. */

const money = (n: number) =>
  Math.abs(n).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CloseStatement() {
  const reduce = useReducedMotion();
  const { eyebrow, currency, lines, total, notes, footprint } = CLOSE_STATEMENT;

  return (
    <div className="r-close" role="figure" aria-label="A reconciled close: gross invoiced, less gateway fees and exchange differences, equals what the bank credited">
      <div className="r-close-head">
        <span className="r-close-eyebrow">{eyebrow}</span>
        <span className="r-close-cur">{currency}</span>
      </div>

      <dl className="r-close-lines">
        {lines.map((l, i) => (
          <motion.div
            key={l.label}
            className="r-close-row"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: 0.06 * i, duration: 0.4, ease: "easeOut" }}
          >
            <dt>{l.label}</dt>
            <dd className="r-nums" data-kind={l.kind}>
              {l.value < 0 ? "−" : ""}
              {money(l.value)}
            </dd>
          </motion.div>
        ))}
      </dl>

      {/* The rule is the point: everything above it resolves into the line
          below it, and the line below it is what the bank actually paid. */}
      <motion.div
        className="r-close-total"
        initial={reduce ? false : { opacity: 0 }}
        whileInView={reduce ? undefined : { opacity: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ delay: 0.28, duration: 0.45, ease: "easeOut" }}
      >
        <span>{total.label}</span>
        <span className="r-nums">{money(total.value)}</span>
      </motion.div>

      <ul className="r-close-notes">
        {notes.map((n) => (
          <li key={n.label}>
            <span>{n.label}</span>
            <span className="r-nums">{n.value}</span>
          </li>
        ))}
      </ul>

      <p className="r-close-foot">{footprint}</p>
    </div>
  );
}
