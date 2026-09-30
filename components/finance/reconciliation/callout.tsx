"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, XCircle } from "lucide-react";

/* One pattern for every explanation in the recon drawers.
 *
 * The drawers used to carry paragraph-length yellow blocks: the accountant had
 * to read four sentences to learn one fact. Now the headline states the fact
 * and the decision in one line, the numbers that justify it sit as chips, and
 * the full reasoning is one click away under "Why?" — collapsed by default,
 * so the eye lands on the table and the actions, not on prose. */

export type CalloutTone = "success" | "info" | "warn" | "danger";

const TONES: Record<CalloutTone, { box: string; icon: string; Icon: React.ElementType }> = {
  success: { box: "border-[#CFE0D2] bg-[#F4F8F4]", icon: "text-[#4B7A54]", Icon: CheckCircle2 },
  info: { box: "border-[#D8E3E6] bg-[#F4F8F9]", icon: "text-[#2E6B7A]", Icon: Info },
  warn: { box: "border-[#E7D3B0] bg-[#FDF9F1]", icon: "text-[#B0742E]", Icon: AlertTriangle },
  danger: { box: "border-[#EBC9BE] bg-[#FCF4F1]", icon: "text-[#A6472F]", Icon: XCircle },
};

export function Callout({ tone, title, facts, actions, children, defaultOpen = false, className = "" }: {
  tone: CalloutTone;
  /** One line: the fact and what it means for the accountant. */
  title: React.ReactNode;
  /** Key figures, shown as chips under the title. */
  facts?: { label: string; value: React.ReactNode; emphasis?: boolean }[];
  /** Buttons that act on this callout — always visible. */
  actions?: React.ReactNode;
  /** The long explanation — hidden behind "Why?". */
  children?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const t = TONES[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`mb-3 rounded-lg border px-3 py-2.5 ${t.box} ${className}`}>
      <div className="flex items-start gap-2">
        <t.Icon size={15} className={`mt-[1px] shrink-0 ${t.icon}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="text-[13px] font-medium leading-snug text-[#0F1B3D]">{title}</div>
            {children && (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="inline-flex shrink-0 items-center gap-0.5 text-[11.5px] font-medium text-[#46546F] hover:text-[#0F1B3D]"
              >
                {open ? "Hide" : "Why?"} <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
              </button>
            )}
          </div>
          {facts && facts.length > 0 && <FactChips facts={facts} className="mt-1.5" />}
          {open && children && <div className="mt-2 text-[12.5px] leading-relaxed text-[#52514E]">{children}</div>}
          {actions && <div className="mt-2 flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

export function FactChips({ facts, className = "" }: {
  facts: { label: string; value: React.ReactNode; emphasis?: boolean }[];
  className?: string;
}) {
  return (
    <dl className={`flex flex-wrap gap-1.5 ${className}`}>
      {facts.map((f) => (
        <div key={f.label} className="inline-flex items-baseline gap-1 rounded-md bg-white/80 px-2 py-0.5 ring-1 ring-inset ring-[#D8E1F1]">
          <dt className="text-[11px] text-[#5E6B85]">{f.label}</dt>
          <dd className={`text-[12px] tabular-nums ${f.emphasis ? "font-semibold text-[#0F1B3D]" : "text-[#3A332A]"}`}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
