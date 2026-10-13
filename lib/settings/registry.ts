import { z, type ZodType } from "zod";

/* Every workspace setting the app knows. A key not listed here cannot be
 * written. `legacyEnv` names the .env variable a setting replaces: it is the
 * importer's source and, during release 1, the fallback when the database has
 * no value (see lib/settings/index.ts). */

export type SettingGroup = "profile" | "accounting" | "sync" | "advanced";
export type SettingKind = "text" | "number" | "toggle" | "select" | "json" | "tags";

export type SettingDef<T = unknown> = {
  key: string;
  group: SettingGroup;
  label: string;
  help?: string;
  kind: SettingKind;
  options?: string[];
  schema: ZodType<T>;
  default: T;
  legacyEnv?: string;
  parseEnv?: (raw: string) => T;
};

const int = (raw: string) => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};
const intOr = (fallback: number) => (raw: string) => int(raw) ?? fallback;
const bool = (raw: string) => raw.trim().toLowerCase() === "true";
const json = (raw: string) => JSON.parse(raw);
/** null = the scheduler's own built-in default. */
const minutes = z.number().int().positive().nullable();
const hour = z.number().int().min(0).max(23).nullable();
const CURRENCIES = ["AED", "SAR", "KWD", "QAR", "BHD", "OMR", "USD"] as const;
const UAE_TREATMENTS = ["vat_registered", "vat_not_registered", "gcc_vat_registered", "gcc_vat_not_registered", "non_gcc", "dz_vat_registered", "dz_vat_not_registered"] as const;
const INDUSTRIES = ["ecommerce", "wholesale", "construction", "logistics", "services"] as const;

export const SETTINGS: SettingDef<any>[] = [
  // ── profile ─────────────────────────────────────────────────────────
  { key: "app.public_url", group: "profile", label: "Public URL of this app", help: "Used to build OAuth redirect and webhook URLs.", kind: "text", schema: z.string().url(), default: "http://localhost:3000", legacyEnv: "APP_PUBLIC_URL" },
  { key: "profile.legal_name", group: "profile", label: "Legal name", kind: "text", schema: z.string(), default: "" },
  { key: "profile.trn", group: "profile", label: "Tax registration number (TRN)", kind: "text", schema: z.string().regex(/^(\d{15})?$/, "TRN is 15 digits"), default: "" },
  { key: "profile.base_currency", group: "profile", label: "Base currency", kind: "select", options: [...CURRENCIES], schema: z.enum(CURRENCIES), default: "AED" },
  { key: "profile.fiscal_year_end", group: "profile", label: "Fiscal year end (MM-DD)", kind: "text", schema: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Use MM-DD"), default: "12-31" },
  { key: "profile.timezone", group: "profile", label: "Timezone", kind: "text", schema: z.string().min(1), default: "Asia/Dubai" },
  { key: "profile.industries", group: "profile", label: "Industries", kind: "tags", options: [...INDUSTRIES], schema: z.array(z.enum(INDUSTRIES)).min(1, "Pick at least one industry"), default: ["ecommerce"] },
  { key: "profile.modules", group: "profile", label: "Module overrides", kind: "json", schema: z.record(z.boolean()), default: {} },

  // ── accounting ──────────────────────────────────────────────────────
  { key: "zoho.default_connection_id", group: "accounting", label: "Default Zoho organisation", kind: "text", schema: z.string().min(1), default: "env" },
  { key: "zoho.cod_prepaid_org", group: "accounting", label: "Zoho org for prepaid COD orders", kind: "text", schema: z.string(), default: "", legacyEnv: "COD_PREPAID_ORDERS_ZOHO_ORG" },
  { key: "zoho.bank_account_id", group: "accounting", label: "Zoho bank account id (default org)", kind: "text", schema: z.string(), default: "", legacyEnv: "ZOHO_BANK_ACCOUNT_ID" },
  { key: "zoho.fee_account_id", group: "accounting", label: "Zoho fee account id (default org)", kind: "text", schema: z.string(), default: "", legacyEnv: "ZOHO_FEE_ACCOUNT_ID" },
  { key: "zoho.clearing_accounts", group: "accounting", label: "Clearing accounts by gateway", kind: "json", schema: z.record(z.string()), default: {}, legacyEnv: "ZOHO_CLEARING_ACCOUNTS", parseEnv: json },
  { key: "zoho.expense_accounts_by_kind", group: "accounting", label: "Expense accounts by kind", kind: "json", schema: z.record(z.string()), default: {}, legacyEnv: "ZOHO_EXPENSE_ACCOUNTS_BY_KIND", parseEnv: json },
  { key: "zoho.default_income_account_id", group: "accounting", label: "Default income account id", kind: "text", schema: z.string(), default: "", legacyEnv: "ZOHO_DEFAULT_INCOME_ACCOUNT_ID" },
  { key: "zoho.daily_budget", group: "accounting", label: "Zoho daily API budget (default org)", kind: "number", schema: z.number().int().positive(), default: 7000, legacyEnv: "ZOHO_DAILY_BUDGET", parseEnv: intOr(7000) },

  // ── sales orders (daily close from the packing sheet) ───────────────
  { key: "salesorders.fixed_rates", group: "accounting", label: "Sales orders: fixed AED rates", help: "Foreign orders are entered in AED at these rates.", kind: "json", schema: z.record(z.number().positive()), default: { AED: 1, SAR: 0.98, KWD: 11.99, QAR: 1, OMR: 9.54, USD: 3.67 } },
  { key: "salesorders.uae_tax_treatment", group: "accounting", label: "Sales orders: UAE tax treatment", kind: "select", options: [...UAE_TREATMENTS], schema: z.enum(UAE_TREATMENTS), default: "vat_not_registered" },
  { key: "salesorders.uae_tax_name", group: "accounting", label: "Sales orders: UAE tax (Zoho tax name)", kind: "text", schema: z.string().min(1), default: "Standard Rate" },
  { key: "salesorders.gcc_tax_treatment", group: "accounting", label: "Sales orders: GCC tax treatment", kind: "select", options: [...UAE_TREATMENTS], schema: z.enum(UAE_TREATMENTS), default: "gcc_vat_not_registered" },
  { key: "salesorders.gcc_tax_name", group: "accounting", label: "Sales orders: GCC tax (Zoho tax name)", kind: "text", schema: z.string().min(1), default: "Zero Rate" },
  { key: "salesorders.intl_tax_treatment", group: "accounting", label: "Sales orders: outside-GCC tax treatment", kind: "select", options: [...UAE_TREATMENTS], schema: z.enum(UAE_TREATMENTS), default: "non_gcc" },
  { key: "salesorders.intl_tax_name", group: "accounting", label: "Sales orders: outside-GCC tax (Zoho tax name)", kind: "text", schema: z.string().min(1), default: "Zero Rate" },
  { key: "salesorders.invoice_date_source", group: "accounting", label: "Sales orders: invoice date", help: "order = the store order's Dubai date; dispatch = the packing-sheet day; salesorder = the SO's own date.", kind: "select", options: ["order", "dispatch", "salesorder"], schema: z.enum(["order", "dispatch", "salesorder"]), default: "order" },
  { key: "salesorders.mark_sent", group: "accounting", label: "Sales orders: mark invoice as sent", kind: "toggle", schema: z.boolean(), default: true },
  { key: "salesorders.warehouse_id", group: "accounting", label: "Sales orders: default warehouse id", help: "Used for packaging when the SO has no warehouse on its lines.", kind: "text", schema: z.string().min(1), default: "2330082000000980131" },
  { key: "salesorders.max_per_run", group: "accounting", label: "Sales orders: max closed per run", kind: "number", schema: z.number().int().min(1).max(25), default: 10 },
  { key: "salesorders.amount_tolerance_pct", group: "accounting", label: "Sales orders: amount tolerance (%)", help: "SO vs order at the fixed rate; never below AED 1.", kind: "number", schema: z.number().min(0).max(5), default: 0.2 },
  { key: "salesorders.sku_aliases", group: "accounting", label: "Sales orders: packing-sheet SKU → Zoho SKU", help: "e.g. {\"LEDR199\": \"LEDR2\"}", kind: "json", schema: z.record(z.string().min(1)), default: {} },
  { key: "packaging.barcodes", group: "accounting", label: "Packaging: printed barcode → box SKU", help: "For box barcodes that aren't the SKU itself, e.g. {\"6291100000017\": \"PAP999\"}. Scanning SET101 etc. works without this.", kind: "json", schema: z.record(z.string().min(1)), default: {} },
  { key: "payments.expected_days", group: "accounting", label: "Payments: usual days order → bank, per gateway", help: "Money older than this (+ grace) is flagged overdue on the Admin dashboard and chased on Telegram.", kind: "json", schema: z.record(z.number().int().min(0).max(120)), default: { Stripe: 7, "Shopify Payments": 5, Tabby: 7, Tamara: 10, Telr: 7, Checkout: 7, COD: 10 } },
  { key: "payments.overdue_grace_days", group: "accounting", label: "Payments: grace days before overdue", kind: "number", schema: z.number().int().min(0).max(30), default: 2 },
  { key: "alerts.overdue_followups", group: "advanced", label: "Telegram: chase overdue payments", help: "The CFO bot posts overdue gateway money at 10:00 and 16:00 Dubai.", kind: "toggle", schema: z.boolean(), default: true },
  { key: "alerts.overdue_call_to", group: "advanced", label: "Daily overdue call: phone number", help: "E.164, e.g. +9715XXXXXXXX. Needs TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM. Empty = no call.", kind: "text", schema: z.string().regex(/^(\+\d{8,15})?$/, "Use +countrycode…"), default: "" },
  { key: "alerts.overdue_call_min_aed", group: "advanced", label: "Daily overdue call: only when overdue above (AED)", kind: "number", schema: z.number().min(0), default: 5000 },
  { key: "salesorders.packing_sheets", group: "accounting", label: "Sales orders: packing sheet per month", help: "{\"2026-10\": \"<sheet id or link>\"}", kind: "json", schema: z.record(z.string().min(1)), default: { "2026-10": "1krsLLGY9OgEF89l5ac71B8PjPobcuM2yXwas9fcTai4" } },

  // ── sync & schedules ────────────────────────────────────────────────
  { key: "sync.order_interval_minutes", group: "sync", label: "Order sync every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "ORDER_SYNC_INTERVAL_MINUTES", parseEnv: int },
  { key: "sync.payout_interval_minutes", group: "sync", label: "Payout sync every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "PAYOUT_SYNC_INTERVAL_MINUTES", parseEnv: int },
  { key: "sync.shopify_payments_interval_minutes", group: "sync", label: "Shopify Payments sync every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "SHOPIFY_PAYMENTS_SYNC_MINUTES", parseEnv: int },
  { key: "sync.zoho_interval_minutes", group: "sync", label: "Zoho sync every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "ZOHO_SYNC_INTERVAL_MINUTES", parseEnv: int },
  { key: "sync.payment_confirm_interval_minutes", group: "sync", label: "Payment confirmation every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "PAYMENT_CONFIRM_INTERVAL_MINUTES", parseEnv: int },
  { key: "sync.gmail_interval_minutes", group: "sync", label: "Gmail payout ingest every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "GMAIL_INGEST_INTERVAL_MINUTES", parseEnv: int },
  { key: "sync.ad_interval_minutes", group: "sync", label: "Ad sync every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "AD_SYNC_INTERVAL_MINUTES", parseEnv: int },
  { key: "sync.cfo_digest_hour", group: "sync", label: "CFO digest hour (Dubai)", kind: "number", schema: hour, default: null, legacyEnv: "CFO_DIGEST_HOUR_DUBAI", parseEnv: int },
  { key: "sync.group_summary_hour", group: "sync", label: "Group summary hour (Dubai)", kind: "number", schema: hour, default: null, legacyEnv: "GROUP_SUMMARY_HOUR_DUBAI", parseEnv: int },

  // ── advanced ────────────────────────────────────────────────────────
  { key: "shopify.api_version", group: "advanced", label: "Shopify Admin API version", kind: "text", schema: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"), default: "2024-04", legacyEnv: "SHOPIFY_API_VERSION" },
  { key: "shopify.analytics_api_version", group: "advanced", label: "Shopify analytics API version", kind: "text", schema: z.string().regex(/^(\d{4}-\d{2}|unstable)$/, "Use YYYY-MM or unstable"), default: "2025-10", legacyEnv: "SHOPIFY_ANALYTICS_API_VERSION" },
  { key: "orders.wa_count_cod_as_paid", group: "advanced", label: "Count WhatsApp COD orders as paid", kind: "toggle", schema: z.boolean(), default: false, legacyEnv: "ORDERS_WA_COUNT_COD_AS_PAID", parseEnv: bool },
  { key: "inventory.stock_write_mode", group: "advanced", label: "Stock write mode", kind: "select", options: ["off", "shadow", "live"], schema: z.enum(["off", "shadow", "live"]), default: "off", legacyEnv: "STOCK_WRITE_MODE" },
  { key: "orders.woo_sync", group: "advanced", label: "WooCommerce order sync", kind: "toggle", schema: z.boolean(), default: true, legacyEnv: "WOO_ORDER_SYNC", parseEnv: (r) => r.trim().toLowerCase() !== "off" },
  { key: "zoho.min_gap_ms", group: "advanced", label: "Zoho min gap between calls (ms)", kind: "number", schema: z.number().int().min(0), default: 150, legacyEnv: "ZOHO_MIN_GAP_MS", parseEnv: intOr(150) },
  { key: "zoho.max_429_retries", group: "advanced", label: "Zoho 429 retries", kind: "number", schema: z.number().int().min(0), default: 3, legacyEnv: "ZOHO_MAX_429_RETRIES", parseEnv: intOr(3) },
  { key: "zoho.max_retry_wait_ms", group: "advanced", label: "Zoho max retry wait (ms)", kind: "number", schema: z.number().int().min(0), default: 120000, legacyEnv: "ZOHO_MAX_RETRY_WAIT_MS", parseEnv: intOr(120000) },
  { key: "sheets.spreadsheet_id", group: "advanced", label: "Dispatch intake spreadsheet id", kind: "text", schema: z.string(), default: "", legacyEnv: "GOOGLE_SHEETS_SPREADSHEET_ID" },
  { key: "sheets.payments_spreadsheet_id", group: "advanced", label: "Payments spreadsheet id (pinned month)", kind: "text", schema: z.string(), default: "", legacyEnv: "GOOGLE_SHEETS_PAYMENTS_SPREADSHEET_ID" },
  { key: "alerts.telegram_chat_id", group: "advanced", label: "Telegram chat id", kind: "text", schema: z.string(), default: "", legacyEnv: "TELEGRAM_CHAT_ID" },
  { key: "alerts.telegram_alert_chat_id", group: "advanced", label: "Telegram alert chat id", kind: "text", schema: z.string(), default: "", legacyEnv: "TELEGRAM_ALERT_CHAT_ID" },
  { key: "email.from", group: "advanced", label: "From email address", kind: "text", schema: z.string(), default: "", legacyEnv: "FROM_EMAIL" },
];

export const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
