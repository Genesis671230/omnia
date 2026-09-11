"use client";

import { useState } from "react";
import { ShieldCheck, ArrowRight, RotateCcw, AlertTriangle, CheckCircle2 } from "lucide-react";

/* In-browser FTA compliance risk check. Nothing is sent anywhere — the score
   is computed locally and the CTA points at the consultation form. Mirrors the
   numio reference: 7 questions, each mapped to a real penalty exposure. */

type Answer = "yes" | "no" | "unsure";

const QUESTIONS: {
  q: string;
  // which answer is the risky one
  risky: Answer;
  area: string;
  penalty: string;
  weight: number;
}[] = [
  {
    q: "Is your business registered for Corporate Tax with the FTA?",
    risky: "no",
    area: "Corporate Tax registration",
    penalty: "AED 10,000 late-registration penalty",
    weight: 3,
  },
  {
    q: "If your taxable turnover is above AED 375,000, are you registered for VAT?",
    risky: "no",
    area: "VAT registration",
    penalty: "AED 10,000 late-registration penalty",
    weight: 3,
  },
  {
    q: "Has every VAT return been filed and paid on time in the last 2 years?",
    risky: "no",
    area: "Late returns and payment",
    penalty: "AED 1,000 to 2,000 per return, plus 2 to 4% and 1%/day on payment",
    weight: 2,
  },
  {
    q: "Do all your sales invoices carry a valid TRN and the required tax-invoice fields?",
    risky: "no",
    area: "Non-compliant tax invoices",
    penalty: "AED 2,500 per instance",
    weight: 2,
  },
  {
    q: "Is reverse charge applied on foreign platform fees (Amazon, Shopify, Meta, Google)?",
    risky: "no",
    area: "Reverse charge on imported services",
    penalty: "Incorrect return, from AED 500, plus recovered VAT at risk",
    weight: 2,
  },
  {
    q: "Are personal and business expenses fully separated in your books?",
    risky: "no",
    area: "Mixed personal spend",
    penalty: "Disallowed deductions and incorrect-return penalties",
    weight: 1,
  },
  {
    q: "Do you keep accounting records and supporting documents for at least 7 years?",
    risky: "no",
    area: "Record keeping",
    penalty: "AED 10,000, then AED 20,000 on repeat",
    weight: 2,
  },
];

export function RiskCheck({ ctaHref = "#consultation" }: { ctaHref?: string }) {
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<(Answer | null)[]>(Array(QUESTIONS.length).fill(null));
  const [submitted, setSubmitted] = useState(false);

  const answeredCount = answers.filter(Boolean).length;
  const done = answeredCount === QUESTIONS.length;

  const flags = QUESTIONS.map((item, i) => {
    const a = answers[i];
    if (!a) return null;
    if (a === item.risky) return { ...item, level: "high" as const };
    if (a === "unsure") return { ...item, level: "review" as const };
    return null;
  }).filter(Boolean) as ({ area: string; penalty: string; weight: number; level: "high" | "review" })[];

  const score = flags.reduce((s, f) => s + (f.level === "high" ? f.weight : 1), 0);
  const band = score >= 6 ? "High" : score >= 3 ? "Moderate" : score > 0 ? "Low" : "Clear";
  const bandColor =
    band === "High"
      ? "text-red-600"
      : band === "Moderate"
        ? "text-amber-600"
        : band === "Low"
          ? "text-blue-600"
          : "text-emerald-600";

  function reset() {
    setAnswers(Array(QUESTIONS.length).fill(null));
    setSubmitted(false);
  }

  if (!started) {
    return (
      <div className="rounded-2xl border border-blue-100 bg-white p-8 text-center shadow-sm">
        <ShieldCheck className="mx-auto size-9 text-blue-600" />
        <h3 className="mt-4 font-display text-2xl text-slate-900">Compliance diagnostic</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          7 questions. Runs entirely in your browser, nothing is sent anywhere. We map each
          answer to a real FTA requirement and show where you are exposed.
        </p>
        <button
          onClick={() => setStarted(true)}
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Check my risk
          <ArrowRight className="size-4" />
        </button>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Your exposure
        </p>
        <p className={`mt-1 font-display text-4xl ${bandColor}`}>{band} risk</p>
        <p className="mt-2 text-sm text-slate-500">
          Based on {flags.length} flagged area{flags.length === 1 ? "" : "s"} out of{" "}
          {QUESTIONS.length}. Indicative only, confirm the current position with a tax manager.
        </p>

        {flags.length > 0 ? (
          <ul className="mt-5 space-y-3">
            {flags.map((f) => (
              <li
                key={f.area}
                className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <AlertTriangle
                  className={`mt-0.5 size-4 shrink-0 ${f.level === "high" ? "text-red-500" : "text-amber-500"}`}
                />
                <div>
                  <p className="text-sm font-semibold text-slate-800">{f.area}</p>
                  <p className="text-xs text-slate-500">{f.penalty}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle2 className="size-4" />
            No obvious gaps from these questions. A full review still catches the rest.
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={ctaHref}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Size my exposure on a call
            <ArrowRight className="size-4" />
          </a>
          <button
            onClick={reset}
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 px-5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <RotateCcw className="size-4" />
            Start over
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Compliance diagnostic
        </p>
        <p className="text-xs text-slate-400">
          {answeredCount} / {QUESTIONS.length}
        </p>
      </div>
      <div className="mb-6 h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-blue-600 transition-all"
          style={{ width: `${(answeredCount / QUESTIONS.length) * 100}%` }}
        />
      </div>

      <ol className="space-y-5">
        {QUESTIONS.map((item, i) => (
          <li key={item.q}>
            <p className="text-sm font-medium text-slate-800">
              {i + 1}. {item.q}
            </p>
            <div className="mt-2 flex gap-2">
              {(["yes", "no", "unsure"] as Answer[]).map((opt) => {
                const active = answers[i] === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      setAnswers((prev) => {
                        const next = [...prev];
                        next[i] = opt;
                        return next;
                      })
                    }
                    className={`h-9 rounded-lg border px-4 text-xs font-medium capitalize transition-colors ${
                      active
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-300 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>

      <button
        type="button"
        disabled={!done}
        onClick={() => setSubmitted(true)}
        className="mt-7 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        See my exposure
        <ArrowRight className="size-4" />
      </button>
    </div>
  );
}
