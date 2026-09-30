"use client";

/* Corporate Tax lead form — two short steps, WhatsApp first.
 *
 *   Step 1  what you need (one tap) · WhatsApp · company      ← the lead
 *   Step 2  name · email (+ notice date for a penalty)        ← the follow-up
 *
 * Posts to /api/lead/ct (same payload as before, so the API, Supabase row,
 * Telegram alert and CAPI dedup are unchanged). A penalty-checker result or a
 * pricing-counter quote rides along in `checker`, so the accountant knows the
 * estimate before calling. Server-side field errors send the visitor back to
 * the step that holds the field. */

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, CalendarClock, CheckCircle2, FileCheck2, Loader2, Lock, Mail, MessageCircle, ReceiptText, ShieldAlert, User } from "lucide-react";
import { useEffect, useState } from "react";
import { getAttribution } from "@/lib/ramza/attribution";
import { FILING_PARTNER } from "@/lib/ramza/rules";
import { track, trackOnce } from "@/lib/ramza/track";
import type { CheckerHandoff } from "./checker";
import { QUOTE_EVENT, type QuoteHandoff } from "./pricing-counter";
import { ct } from "./brand";

const SITUATIONS = [
  { k: "file_return", label: "File my CT return", icon: FileCheck2 },
  { k: "missed_deadline", label: "I missed the deadline", icon: CalendarClock },
  { k: "books_behind", label: "Catch up my books", icon: ReceiptText },
  { k: "got_penalty", label: "I got a penalty", icon: ShieldAlert },
] as const;

const PHONE_RE = /^\+?\d[\d\s().-]{7,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STEP1 = new Set(["situation", "whatsapp", "company"]);
const EASE = [0.22, 1, 0.36, 1] as const;

function Field({ icon: Icon, error, children }: { icon: typeof User; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={`group relative flex items-center rounded-2xl border bg-white transition focus-within:border-[#2347D9] focus-within:ring-4 focus-within:ring-[#2347D9]/12 ${error ? "border-[#F3B3BF]" : "border-[#D9E1F5]"}`}>
        <Icon size={17} className="pointer-events-none absolute left-4 text-[#9AA6C8] transition group-focus-within:text-[#2347D9]" />
        {children}
      </div>
      {error && <p className={ct.error}>{error}</p>}
    </div>
  );
}
const inputCls = "h-[52px] w-full rounded-2xl bg-transparent pl-11 pr-4 text-[15px] text-[#0A1A4A] placeholder:text-[#9AA6C8] focus:outline-none";

export function CtLeadForm({ handoff, dark = false, cta = "Start my filing", placement = "form" }: { handoff?: CheckerHandoff | null; dark?: boolean; cta?: string; placement?: string }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [situation, setSituation] = useState<string>("file_return");
  const [v, setV] = useState({ whatsapp: "", company: "", name: "", email: "" });
  const [issuedOn, setIssuedOn] = useState("");
  const [quote, setQuote] = useState<QuoteHandoff | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // A checker result pre-fills what it knows.
  useEffect(() => {
    if (!handoff) return;
    setSituation(handoff.input.penaltyType === "not_sure" ? "missed_deadline" : "got_penalty");
    if (handoff.input.issuedOn) setIssuedOn(handoff.input.issuedOn);
  }, [handoff]);

  // A pricing-counter quote arrives by window event.
  useEffect(() => {
    const on = (e: Event) => {
      const q = (e as CustomEvent<QuoteHandoff>).detail;
      setQuote(q);
      if (q.rescue) setSituation("missed_deadline");
    };
    window.addEventListener(QUOTE_EVENT, on);
    return () => window.removeEventListener(QUOTE_EVENT, on);
  }, []);

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((cur) => ({ ...cur, [k]: e.target.value }));

  function next() {
    const errs: Record<string, string> = {};
    if (!PHONE_RE.test(v.whatsapp.trim())) errs.whatsapp = "Add your WhatsApp with country code, e.g. +971 50 123 4567.";
    if (v.company.trim().length < 2) errs.company = "Add your company name.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    track("FormStep", { placement, step: 2, situation });
    setStep(2);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step === 1) return next();
    const errs: Record<string, string> = {};
    if (v.name.trim().length < 2) errs.name = "Add your name.";
    if (!EMAIL_RE.test(v.email.trim())) errs.email = "Add a valid email.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const fd = new FormData(e.currentTarget);
    const eventId = crypto.randomUUID();
    setStatus("sending");
    const checker = handoff
      ? { headline: handoff.result.headline, tone: handoff.result.tone, estimatedAed: handoff.result.estimatedAed }
      : quote
        ? { headline: `Pricing counter: ${quote.summary}`, tone: quote.rescue ? "act" : "info", estimatedAed: quote.monthlyAed ?? 0 }
        : null;
    try {
      const res = await fetch("/api/lead/ct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...v, situation, penaltyIssuedOn: issuedOn, penaltyType: handoff?.input.penaltyType ?? "", checker,
          company_website: fd.get("company_website"), // honeypot
          eventId, attribution: getAttribution(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 400 && json.errors) {
        setErrors(json.errors);
        if (Object.keys(json.errors).some((k) => STEP1.has(k))) setStep(1);
        setStatus("error");
        return;
      }
      if (!res.ok) { setErrors({ _form: json.error || "Something went wrong. Please try again." }); setStatus("error"); return; }
      track("Lead", { eventId: json.event_id || eventId, placement, situation });
      setStatus("done");
    } catch {
      setErrors({ _form: "Network error. Please try again or message us on WhatsApp." });
      setStatus("error");
    }
  }

  if (status === "done") {
    const steps = ["An accountant messages you on WhatsApp", "You share bank statements & invoices", "Fixed quote — then we get to work"];
    return (
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="py-4 text-center">
        <div className="relative mx-auto h-20 w-20">
          {[0, 1].map((i) => (
            <motion.span key={i} className="absolute inset-0 rounded-full bg-emerald-400/30" initial={{ scale: 0.6, opacity: 0.8 }} animate={{ scale: 1.8, opacity: 0 }} transition={{ duration: 1.4, delay: i * 0.4, repeat: 1 }} />
          ))}
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 14 }}
            className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_16px_40px_-12px_rgba(16,185,129,0.7)]">
            <CheckCircle2 size={36} />
          </motion.span>
        </div>
        <h3 className="mt-5 text-[21px] font-medium text-[#0A1A4A]">You’re in, {v.name.trim().split(" ")[0] || "thanks"}!</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-[14px] text-[#4A5680]">Here’s what happens next:</p>
        <ol className="mx-auto mt-4 max-w-xs space-y-2 text-left">
          {steps.map((s, i) => (
            <motion.li key={s} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.15 }} className="flex items-center gap-3 text-[13.5px] text-[#0A1A4A]">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EEF3FF] text-[12px] font-medium text-[#2347D9]">{i + 1}</span>{s}
            </motion.li>
          ))}
        </ol>
      </motion.div>
    );
  }

  const quoteNote = handoff ? handoff.result.headline : quote ? quote.summary : null;

  return (
    <form onSubmit={submit} noValidate onFocusCapture={() => trackOnce(`formstart:${placement}`, "FormStart", { placement })}>
      {/* progress */}
      <div className="mb-5 flex items-center gap-3">
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEF3FF]">
          <motion.div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#2347D9] to-[#4C7BFF]" animate={{ width: step === 1 ? "50%" : "100%" }} transition={{ duration: 0.5, ease: EASE }} />
        </div>
        <span className="text-[12px] tabular-nums text-[#8A96BD]">Step {step} of 2</span>
      </div>

      {quoteNote && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-4 rounded-2xl bg-[#EEF3FF] px-4 py-3 text-[12.5px] leading-relaxed text-[#0A1A4A]">
          <b className="font-medium">{handoff ? "Your check:" : "Your estimate:"}</b> {quoteNote}
        </motion.div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {step === 1 ? (
          <motion.div key="s1" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25, ease: EASE }}>
            <span className={ct.label}>What do you need?</span>
            <div className="mb-4 grid grid-cols-2 gap-2">
              {SITUATIONS.map((s) => {
                const on = situation === s.k;
                return (
                  <motion.button key={s.k} type="button" whileTap={{ scale: 0.97 }} onClick={() => setSituation(s.k)} aria-pressed={on}
                    className={`relative flex min-h-[52px] items-center gap-2.5 rounded-2xl border px-3 py-2 text-left text-[13px] leading-snug transition ${on ? "border-[#2347D9] bg-[#EEF3FF] font-medium text-[#0A1A4A]" : "border-[#D9E1F5] bg-white text-[#4A5680] hover:border-[#9FB4F2]"}`}>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition ${on ? "bg-[#2347D9] text-white" : "bg-[#F2F5FD] text-[#6B77A0]"}`}><s.icon size={15} /></span>
                    {s.label}
                  </motion.button>
                );
              })}
            </div>
            <div className="space-y-3">
              <Field icon={MessageCircle} error={errors.whatsapp}>
                <input name="whatsapp" type="tel" inputMode="tel" autoComplete="tel" value={v.whatsapp} onChange={set("whatsapp")} className={inputCls} placeholder="WhatsApp  +971 50 123 4567" aria-label="WhatsApp number" />
              </Field>
              <Field icon={Building2} error={errors.company}>
                <input name="company" autoComplete="organization" value={v.company} onChange={set("company")} className={inputCls} placeholder="Company name" aria-label="Company" />
              </Field>
            </div>
            {errors.situation && <p className={ct.error}>{errors.situation}</p>}
            <button type="submit" className={`${ct.btnPrimary} mt-5 h-[52px] w-full`}>Continue <ArrowRight size={16} /></button>
          </motion.div>
        ) : (
          <motion.div key="s2" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.25, ease: EASE }}>
            <p className="mb-3 text-[13.5px] text-[#4A5680]">Almost there — who should the accountant ask for?</p>
            <div className="space-y-3">
              <Field icon={User} error={errors.name}>
                <input name="name" autoComplete="name" value={v.name} onChange={set("name")} className={inputCls} placeholder="Your name" aria-label="Your name" autoFocus />
              </Field>
              <Field icon={Mail} error={errors.email}>
                <input name="email" type="email" autoComplete="email" value={v.email} onChange={set("email")} className={inputCls} placeholder="you@company.com" aria-label="Email" />
              </Field>
              {situation === "got_penalty" && (
                <Field icon={CalendarClock}>
                  <input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} className={inputCls} aria-label="Date on the penalty notice (optional)" />
                </Field>
              )}
            </div>
            {errors._form && <p className={`${ct.error} mt-3`}>{errors._form}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setStep(1)} className="inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-[#D9E1F5] text-[#4A5680] transition hover:border-[#2347D9] hover:text-[#2347D9]" aria-label="Back"><ArrowLeft size={17} /></button>
              <button type="submit" disabled={status === "sending"} className={`${ct.btnPrimary} h-[52px] flex-1`}>
                {status === "sending" && <Loader2 size={16} className="animate-spin" />} {cta} <ArrowRight size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* honeypot — hidden from people, bots fill it */}
      <input name="company_website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <div className={`mt-4 flex items-center justify-center gap-2 text-[12px] ${dark ? "text-[#B9C6EE]" : "text-[#8A96BD]"}`}>
        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
        Accountants online · free review · fixed quote
      </div>
      <p className={`mt-1.5 flex items-center justify-center gap-1.5 text-[11.5px] ${dark ? "text-[#8FA0D6]" : "text-[#A3AECF]"}`}>
        <Lock size={11} /> Returns filed via our licensed partner, {FILING_PARTNER}
      </p>
    </form>
  );
}
