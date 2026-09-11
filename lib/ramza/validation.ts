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
