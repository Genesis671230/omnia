"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Check } from "lucide-react";
import { Section, SectionHeading } from "./ui/section";
import { getAttribution } from "@/lib/ramza/attribution";
import {
  AUDIT_COPY,
  GATEWAY_OPTIONS,
  MONTHLY_ORDER_BANDS,
  ACCOUNTING_TOOLS,
} from "@/lib/ramza/copy";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

type Status = "idle" | "submitting" | "done" | "error";
type Errors = Record<string, string>;

const CAL_LINK = process.env.NEXT_PUBLIC_CAL_LINK;

export function AuditForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<Errors>({});
  const [gateways, setGateways] = useState<string[]>([]);
  const [tool, setTool] = useState("");

  // Deep link from the "on request" integration chips: ?tool=xero#audit
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tool");
    if (t && ACCOUNTING_TOOLS.some((x) => x.value === t)) setTool(t);
  }, []);

  function toggleGateway(g: string) {
    setGateways((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    setErrors({});

    const fd = new FormData(e.currentTarget);
    const eventId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(Date.now());

    const payload = {
      name: fd.get("name"),
      whatsapp: fd.get("whatsapp"),
      email: fd.get("email"),
      storeUrl: fd.get("storeUrl"),
      gateways,
      monthlyOrders: fd.get("monthlyOrders"),
      accountingTool: fd.get("accountingTool"),
      company_website: fd.get("company_website"), // honeypot
      eventId,
      attribution: getAttribution(),
    };

    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 400 && json.errors) {
        setErrors(json.errors);
        setStatus("error");
        return;
      }
      if (!res.ok) {
        setErrors({ _form: json.error || "Something went wrong. Please try again." });
        setStatus("error");
        return;
      }

      // Success only: fire the browser Pixel Lead with the shared event_id.
      window.fbq?.("track", "Lead", {}, { eventID: json.event_id || eventId });
      setStatus("done");
    } catch {
      setErrors({ _form: "Network error. Please try again or message us on WhatsApp." });
      setStatus("error");
    }
  }

  return (
    <Section id="audit" field>
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <SectionHeading>Free payout audit</SectionHeading>
          <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
            {AUDIT_COPY}
          </p>
        </div>

        {status === "done" ? (
          <div className="r-glass rounded-2xl p-6 sm:p-8">
            <div
              className="inline-flex size-9 items-center justify-center rounded-full"
              style={{ background: "color-mix(in srgb, var(--ledger) 16%, transparent)" }}
            >
              <Check className="size-5" style={{ color: "var(--ledger)" }} />
            </div>
            <h3 className="r-h2 mt-3">Audit requested</h3>
            <p className="mt-2 text-sm" style={{ color: "var(--ink-60)" }}>
              We&apos;ll sign an NDA, then send the report within 48 hours of receiving your files.
              Pick a 20-minute slot to walk through it.
            </p>
            {CAL_LINK ? (
              <div className="mt-5 overflow-hidden rounded-lg border r-hairline">
                <iframe
                  title="Book a 20-minute walkthrough"
                  src={`https://cal.com/${CAL_LINK}`}
                  loading="lazy"
                  className="h-[560px] w-full"
                />
              </div>
            ) : (
              <p className="mt-5 text-sm" style={{ color: "var(--ink-60)" }}>
                We&apos;ll message you on WhatsApp to book the walkthrough.
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="r-glass rounded-2xl p-6 sm:p-8">
            <input
              type="text"
              name="company_website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute left-[-9999px] h-0 w-0 opacity-0"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" name="name" error={errors.name} required />
              <Field
                label="WhatsApp number"
                name="whatsapp"
                error={errors.whatsapp}
                placeholder="+971 50 123 4567"
                required
              />
              <Field label="Work email" name="email" type="email" error={errors.email} required />
              <Field label="Store URL" name="storeUrl" error={errors.storeUrl} placeholder="yourstore.com" />
            </div>

            <fieldset className="mt-4">
              <legend className="mb-1.5 block text-xs font-medium" style={{ color: "var(--ink-60)" }}>
                Gateways you use
              </legend>
              <div className="flex flex-wrap gap-2">
                {GATEWAY_OPTIONS.map((g) => {
                  const on = gateways.includes(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggleGateway(g)}
                      aria-pressed={on}
                      className="rounded-lg border px-3 py-1.5 text-sm transition-colors"
                      style={{
                        borderColor: on ? "var(--ledger)" : "var(--rule)",
                        background: on
                          ? "color-mix(in srgb, var(--ledger) 12%, transparent)"
                          : "transparent",
                        color: on ? "var(--ledger)" : "var(--ink)",
                      }}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Monthly orders"
                name="monthlyOrders"
                error={errors.monthlyOrders}
                options={MONTHLY_ORDER_BANDS}
              />
              <SelectField
                label="Accounting tool"
                name="accountingTool"
                error={errors.accountingTool}
                options={ACCOUNTING_TOOLS}
                value={tool}
                onChange={setTool}
              />
            </div>

            {errors._form && (
              <p className="mt-4 text-sm" style={{ color: "var(--stamp)" }}>
                {errors._form}
              </p>
            )}

            <button
              type="submit"
              disabled={status === "submitting"}
              className="r-btn r-btn-primary mt-6 w-full disabled:opacity-60"
            >
              {status === "submitting" && <Loader2 className="size-4 animate-spin" />}
              Request my audit
            </button>
            <p className="mt-3 text-center text-xs" style={{ color: "var(--ink-60)" }}>
              We sign an NDA before you send any files.
            </p>
          </form>
        )}
      </div>
    </Section>
  );
}

function Field({
  label,
  name,
  type = "text",
  error,
  placeholder,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  error?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--ink-60)" }} htmlFor={`f-${name}`}>
        {label}
      </label>
      <input
        id={`f-${name}`}
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        aria-invalid={Boolean(error)}
        className="r-field"
      />
      {error && (
        <p className="mt-1 text-xs" style={{ color: "var(--stamp)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function SelectField({
  label,
  name,
  error,
  options,
  value,
  onChange,
}: {
  label: string;
  name: string;
  error?: string;
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--ink-60)" }} htmlFor={`f-${name}`}>
        {label}
      </label>
      <select
        id={`f-${name}`}
        name={name}
        defaultValue={onChange ? undefined : ""}
        value={onChange ? value ?? "" : undefined}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        aria-invalid={Boolean(error)}
        className="r-field"
      >
        <option value="" disabled>
          Select
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="mt-1 text-xs" style={{ color: "var(--stamp)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
