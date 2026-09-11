"use client";

import { useState, type FormEvent } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";

type Status = "idle" | "submitting" | "done" | "error";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10";
const LABEL = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500";

function readUtm(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"]) {
    const v = p.get(k);
    if (v) out[k] = v;
  }
  return out;
}

export function ConsultationForm({ id = "consultation" }: { id?: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    setError("");

    const fd = new FormData(e.currentTarget);
    const payload = {
      name: fd.get("name"),
      email: fd.get("email"),
      company: fd.get("company"),
      role: fd.get("role"),
      accounting: fd.get("accounting"),
      monthlyOrders: fd.get("volume"),
      message: fd.get("message"),
      website: fd.get("website"),
      utm: readUtm(),
    };

    try {
      const res = await fetch("/api/numio/consultation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }
      setStatus("done");
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div
        id={id}
        className="scroll-mt-24 rounded-2xl border border-blue-100 bg-white p-8 text-center shadow-sm"
      >
        <CheckCircle2 className="mx-auto mb-3 size-9 text-blue-600" />
        <h3 className="font-display text-2xl text-slate-900">Consultation requested</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
          Your numio pod will reach out within 4 business hours to book a free 30-minute call
          and review your current setup.
        </p>
      </div>
    );
  }

  return (
    <form
      id={id}
      onSubmit={onSubmit}
      className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="cf-name">Name</label>
          <input id="cf-name" name="name" required className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="cf-role">Role</label>
          <input id="cf-role" name="role" placeholder="Founder, CFO, Finance lead" className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="cf-email">Work email</label>
          <input id="cf-email" name="email" type="email" required className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="cf-company">Company</label>
          <input id="cf-company" name="company" required className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="cf-accounting">Accounting system</label>
          <select id="cf-accounting" name="accounting" defaultValue="" className={FIELD}>
            <option value="" disabled>Select</option>
            <option value="zoho">Zoho Books</option>
            <option value="xero">Xero</option>
            <option value="quickbooks">QuickBooks</option>
            <option value="tally">Tally</option>
            <option value="sheets">Spreadsheets only</option>
            <option value="none">Nothing yet</option>
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="cf-volume">Monthly transactions</label>
          <select id="cf-volume" name="volume" defaultValue="" className={FIELD}>
            <option value="" disabled>Select</option>
            <option value="0-50">0 to 50</option>
            <option value="50-500">50 to 500</option>
            <option value="500+">500+</option>
            <option value="multi-entity">Multi-entity</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL} htmlFor="cf-message">
            Where do things stand today? Backlog, overdue filings, recent audit
          </label>
          <textarea id="cf-message" name="message" rows={3} className={`${FIELD} resize-y`} />
        </div>
      </div>

      {status === "error" && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
      >
        {status === "submitting" && <Loader2 className="size-4 animate-spin" />}
        Start with a free consultation
      </button>
      <p className="mt-3 text-center text-xs text-slate-400">
        No sign up. No obligation. Your data stays private.
      </p>
    </form>
  );
}
