/* The demo report: validate what the browser sends (numbers only — the
 * visitor's file never leaves their machine), and render the email. */

import { INDUSTRIES, INDUSTRY_LABEL, type Industry } from "./demo/coa";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d[\d\s().-]{7,}$/;
const s = (v: unknown, n: number) => (typeof v === "string" ? v : "").trim().slice(0, n);
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && Math.abs(x) < 1e11 ? Math.round(x * 100) / 100 : 0; };

export type DemoSummary = {
  source: "demo" | "upload"; company: string; invoices: number; cleared: number; unpaid: number; shortPaid: number; retention: number;
  grossAed: number; feeAed: number; vatAed: number; fxAed: number; netAed: number; bankAed: number; payouts: number; bankMatched: number;
  minutesSaved: number; currencies: string[];
  gateways: { gateway: string; grossAed: number; feeAed: number; vatAed: number; effectiveRate: number }[];
  expenses?: { account: string; total: number }[];
};
export type ReportInput = { name: string; email: string; whatsapp: string; company: string; industry: Industry; summary: DemoSummary };

export function validateReport(b: Record<string, unknown>): { ok: true; value: ReportInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = s(b.name, 100), email = s(b.email, 200).toLowerCase(), whatsapp = s(b.whatsapp, 40), company = s(b.company, 140);
  if (name.length < 2) errors.name = "Add your name.";
  if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email.";
  if (whatsapp && !PHONE_RE.test(whatsapp)) errors.whatsapp = "Use a number with country code, e.g. +971 50 123 4567.";
  const industry = (INDUSTRIES as readonly string[]).includes(String(b.industry)) ? (b.industry as Industry) : "ecommerce";
  const r = (b.summary && typeof b.summary === "object" ? b.summary : {}) as Record<string, unknown>;
  const summary: DemoSummary = {
    source: r.source === "upload" ? "upload" : "demo", company: s(r.company, 120),
    invoices: n(r.invoices), cleared: n(r.cleared), unpaid: n(r.unpaid), shortPaid: n(r.shortPaid), retention: n(r.retention),
    grossAed: n(r.grossAed), feeAed: n(r.feeAed), vatAed: n(r.vatAed), fxAed: n(r.fxAed), netAed: n(r.netAed), bankAed: n(r.bankAed),
    payouts: n(r.payouts), bankMatched: n(r.bankMatched), minutesSaved: n(r.minutesSaved),
    currencies: Array.isArray(r.currencies) ? r.currencies.slice(0, 8).map((c) => s(c, 3).toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)) : [],
    gateways: Array.isArray(r.gateways) ? r.gateways.slice(0, 10).map((g) => { const x = (g ?? {}) as Record<string, unknown>; return { gateway: s(x.gateway, 40), grossAed: n(x.grossAed), feeAed: n(x.feeAed), vatAed: n(x.vatAed), effectiveRate: Math.min(Math.max(n(x.effectiveRate), 0), 1) }; }) : [],
    expenses: Array.isArray(r.expenses) ? r.expenses.slice(0, 12).map((e) => { const x = (e ?? {}) as Record<string, unknown>; return { account: s(x.account, 60), total: n(x.total) }; }) : undefined,
  };
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { name, email, whatsapp, company, industry, summary } };
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const aed = (v: number) => `AED ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function reportEmailHtml(r: ReportInput, links: { whatsapp: string; site: string }): string {
  const x = r.summary;
  const first = esc(r.name.split(/\s+/)[0] || "there");
  const rate = x.invoices ? Math.round((x.cleared / x.invoices) * 100) : 0;
  const hours = (x.minutesSaved / 60).toFixed(1);
  const row = (k: string, v: string, strong = false) =>
    `<tr><td style="padding:9px 0;color:#55525E;font-size:14px;border-bottom:1px solid #EFEDE8">${k}</td><td style="padding:9px 0;text-align:right;font-size:14px;border-bottom:1px solid #EFEDE8;${strong ? "font-weight:700;color:#14131C" : "color:#14131C"}">${v}</td></tr>`;
  const gw = x.gateways.map((g) => `<tr><td style="padding:7px 0;font-size:13px;color:#14131C">${esc(g.gateway)}</td><td style="padding:7px 0;text-align:right;font-size:13px;color:#55525E">${aed(g.grossAed)}</td><td style="padding:7px 0;text-align:right;font-size:13px;color:#14131C">${(g.effectiveRate * 100).toFixed(2)}%</td></tr>`).join("");
  const exp = (x.expenses ?? []).slice(0, 8).map((e) => `<tr><td style="padding:6px 0;font-size:13px;color:#14131C">${esc(e.account)}</td><td style="padding:6px 0;text-align:right;font-size:13px;color:#55525E">${aed(e.total)}</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#FAF9F6;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14131C">
<div style="max-width:600px;margin:0 auto;padding:28px 18px">
  <div style="font-size:15px;font-weight:700;letter-spacing:.02em;margin-bottom:22px">RAMZA</div>
  <div style="background:#14131C;border-radius:24px;padding:28px 26px;color:#fff">
    <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#CBC3FF">Your reconciliation report · ${esc(INDUSTRY_LABEL[r.industry])}</div>
    <div style="font-size:28px;font-weight:600;line-height:1.15;margin:12px 0 6px">${rate}% of invoices cleared automatically</div>
    <div style="font-size:15px;color:#B8B6C0">Hi ${first}, here is what RAMZA found in ${x.source === "upload" ? "your file" : `the ${esc(INDUSTRY_LABEL[r.industry])} demo month`}${x.company ? ` (${esc(x.company)})` : ""}. Roughly <b style="color:#fff">${hours} hours</b> of spreadsheet matching, done in under a minute.</div>
  </div>
  <div style="background:#fff;border:1px solid #E8E5DE;border-radius:20px;padding:20px 22px;margin-top:14px">
    <table style="width:100%;border-collapse:collapse">
      ${row("Gross collected", aed(x.grossAed), true)}
      ${row("Gateway fees", aed(x.feeAed))}
      ${row("VAT on fees (recoverable)", aed(x.vatAed))}
      ${x.fxAed ? row("Exchange difference", aed(x.fxAed)) : ""}
      ${row("Net into the bank", aed(x.bankAed || x.netAed), true)}
      ${row("Invoices cleared", `${x.cleared} of ${x.invoices}`)}
      ${x.unpaid ? row("Still unpaid", String(x.unpaid)) : ""}
      ${x.shortPaid ? row("Short-paid — to chase", String(x.shortPaid)) : ""}
      ${x.retention ? row("Retention held", String(x.retention)) : ""}
      ${row("Payouts matched to the bank", `${x.bankMatched} of ${x.payouts}`)}
      ${x.currencies.length > 1 ? row("Currencies converted", x.currencies.join(", ")) : ""}
    </table>
  </div>
  ${gw ? `<div style="background:#fff;border:1px solid #E8E5DE;border-radius:20px;padding:18px 22px;margin-top:14px">
    <div style="font-size:13px;font-weight:700;margin-bottom:6px">What each gateway really costs you</div>
    <table style="width:100%;border-collapse:collapse"><tr><td style="font-size:11px;color:#A19EA6">Gateway</td><td style="font-size:11px;color:#A19EA6;text-align:right">Collected</td><td style="font-size:11px;color:#A19EA6;text-align:right">Fee + VAT</td></tr>${gw}</table>
  </div>` : ""}
  ${exp ? `<div style="background:#fff;border:1px solid #E8E5DE;border-radius:20px;padding:18px 22px;margin-top:14px">
    <div style="font-size:13px;font-weight:700;margin-bottom:6px">Bank lines, sorted into your chart of accounts</div>
    <table style="width:100%;border-collapse:collapse">${exp}</table>
  </div>` : ""}
  <div style="margin:22px 0 8px;font-size:15px;line-height:1.6">Want this every day, booked straight into Zoho, Xero or QuickBooks — with a WhatsApp note when each payout lands?</div>
  <a href="${links.whatsapp}" style="display:inline-block;background:#4F35E8;color:#fff;text-decoration:none;border-radius:999px;padding:13px 22px;font-size:15px;font-weight:600">Set it up for my business</a>
  <div style="margin-top:26px;font-size:12px;color:#A19EA6;line-height:1.6">Figures come from ${x.source === "upload" ? "the file you checked in your browser — RAMZA never received the file itself" : "RAMZA's demo data"}. Gateway fees and exchange rates in the demo are illustrative. RAMZA is not a registered tax agent; filings are made through a licensed partner.<br/><a href="${links.site}" style="color:#A19EA6">${esc(links.site.replace(/^https?:\/\//, ""))}</a></div>
</div></body></html>`;
}
