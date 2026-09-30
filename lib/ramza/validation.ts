/* Hand validation for the audit-form payload — matches the repo style (no zod).
   Messages are specific so the form can render them inline. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// at least a country code and 7+ digits, allows +, spaces, dashes, parens
const PHONE_RE = /^\+?\d[\d\s().-]{7,}$/;

const ORDER_BANDS = new Set(["<500", "500-2000", "2000-10000", "10000+"]);
const TOOLS = new Set(["zoho", "xero", "quickbooks", "excel-none"]);
const GATEWAYS = new Set([
  "Stripe",
  "Telr",
  "Tabby",
  "Tamara",
  "Checkout.com",
  "Cash on delivery",
]);

export type LeadInput = {
  name: string;
  whatsapp: string;
  email: string;
  storeUrl: string;
  gateways: string[];
  monthlyOrders: string;
  accountingTool: string;
};

export type ValidationResult =
  | { ok: true; value: LeadInput }
  | { ok: false; errors: Record<string, string> };

const s = (v: unknown, max: number) =>
  (typeof v === "string" ? v : "").trim().slice(0, max);

export function validateLead(body: unknown): ValidationResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const name = s(b.name, 120);
  if (name.length < 2) errors.name = "Enter your name.";

  const whatsapp = s(b.whatsapp, 40);
  if (!whatsapp) errors.whatsapp = "Add a WhatsApp number with country code.";
  else if (!PHONE_RE.test(whatsapp))
    errors.whatsapp = "Add a WhatsApp number with country code, e.g. +971 50 123 4567.";

  const email = s(b.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) errors.email = "Enter a valid work email.";

  const storeUrl = s(b.storeUrl, 300);

  const gatewaysRaw = Array.isArray(b.gateways) ? b.gateways : [];
  const gateways = gatewaysRaw
    .map((g) => s(g, 40))
    .filter((g) => GATEWAYS.has(g));

  const monthlyOrders = s(b.monthlyOrders, 20);
  if (!ORDER_BANDS.has(monthlyOrders))
    errors.monthlyOrders = "Pick your monthly order volume.";

  const accountingTool = s(b.accountingTool, 20);
  if (!TOOLS.has(accountingTool))
    errors.accountingTool = "Pick your accounting tool.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, whatsapp, email, storeUrl, gateways, monthlyOrders, accountingTool },
  };
}

/* ── Corporate Tax penalty lead (/ramza hero form) ─────────────────────────
   Kept deliberately short so it can be filled in the hero: name, WhatsApp,
   email, company and what happened. Dates and the checker's result ride
   along when the visitor ran the checker first. */

const SITUATIONS = new Set(["file_return", "books_behind", "got_penalty", "missed_deadline", "register_or_file", "other"]);
const PENALTY_TYPES = new Set(["late_registration", "late_filing", "other", "not_sure", ""]);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type CtLeadInput = {
  name: string;
  whatsapp: string;
  email: string;
  company: string;
  situation: string;
  penaltyType: string;
  penaltyIssuedOn: string | null;
  checker: Record<string, unknown> | null;
};

export function validateCtLead(body: unknown): { ok: true; value: CtLeadInput } | { ok: false; errors: Record<string, string> } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const name = s(b.name, 120);
  if (name.length < 2) errors.name = "Enter your name.";
  const whatsapp = s(b.whatsapp, 40);
  if (!PHONE_RE.test(whatsapp)) errors.whatsapp = "Add a WhatsApp number with country code, e.g. +971 50 123 4567.";
  const email = s(b.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email.";
  const company = s(b.company, 160);
  if (company.length < 2) errors.company = "Enter your company name.";
  const situation = s(b.situation, 40);
  if (!SITUATIONS.has(situation)) errors.situation = "Pick what happened.";
  const penaltyType = s(b.penaltyType, 40);
  const issued = s(b.penaltyIssuedOn, 10);

  const checker = b.checker && typeof b.checker === "object" ? (b.checker as Record<string, unknown>) : null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name, whatsapp, email, company, situation,
      penaltyType: PENALTY_TYPES.has(penaltyType) ? penaltyType : "",
      penaltyIssuedOn: DAY_RE.test(issued) ? issued : null,
      // Only the summary fields — never an arbitrary blob from the browser.
      checker: checker
        ? { headline: s(checker.headline, 300), tone: s(checker.tone, 20), estimatedAed: Number(checker.estimatedAed) || 0 }
        : null,
    },
  };
}
