import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { zohoThrottledFetch } from "@/lib/integrations/zoho-throttle";

/* Reference data for the posting dropdowns: expense accounts, equity accounts,
 * bank accounts and taxes. Four Zoho reads.
 *
 * These four almost never change — a chart of accounts is edited a few times a
 * year — but this route was called on every reconciliation page load with its
 * cache commented out, so it spent four requests of a ~5,000/day budget each
 * time. Worse, every Zoho call in this process is serialised through one
 * queue, so those four sat behind whatever else was in flight: the dev log has
 * this route taking 3.9 minutes, twice, waiting its turn.
 *
 * The cache is back on. `?refresh=1` forces a re-read for when someone has
 * just added an account in Zoho and wants to see it in the dropdown. */

export const maxDuration = 60;

const BOOKS_BASE = process.env.ZOHO_BOOKS_BASE ?? "https://www.zohoapis.com/books/v3";
const ORG_ID = process.env.ZOHO_ORGANIZATION_ID ?? "";
const CACHE_TTL_MS = Number(process.env.ZOHO_REFERENCE_TTL_MS ?? 30 * 60 * 1000);

type ReferenceData = {
  expenseAccounts: { account_id: string; account_name: string }[];
  equityAccounts: { account_id: string; account_name: string }[];
  bankAccounts: {
    account_id: string;
    account_name: string;
    account_number?: string;
    currency_code?: string;
  }[];
  taxes: { tax_id: string; tax_name: string; tax_percentage: number }[];
  fetchedAt: string;
};

let cache: { at: number; data: ReferenceData } | null = null;

/* Throws on a Zoho error rather than returning undefined. The previous version
 * had its status checks commented out, so a failed read became `undefined` and
 * then died on `.map()` further down — a 500 with a TypeError instead of the
 * actual Zoho message. */
async function fetchZoho(path: string, token: string, query: Record<string, string> = {}) {
  const url = new URL(`${BOOKS_BASE}${path}`);
  url.searchParams.set("organization_id", ORG_ID);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const res = await zohoThrottledFetch(url.toString(), {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const body = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`Zoho ${path} returned non-JSON (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(String(json.message ?? `Zoho ${path} failed HTTP ${res.status}`));
  }
  return json;
}

export async function GET(request: Request) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });

  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cache.data, cached: true });
  }

  try {
    const token = await getAccessToken();
    // Chart of accounts pulled twice (Expense + Equity filters) so the dropdowns
    // stay tight — otherwise we'd load thousands of irrelevant accounts.
    const [expenseAccounts, equityAccounts, bankAccounts, taxes] = await Promise.all([
      fetchZoho("/chartofaccounts", token, { filter_by: "AccountType.Expense" }),
      fetchZoho("/chartofaccounts", token, { filter_by: "AccountType.Equity" }),
      fetchZoho("/bankaccounts", token),
      fetchZoho("/settings/taxes", token),
    ]);

    const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

    const data: ReferenceData = {
      expenseAccounts: list<{ account_id: string; account_name: string }>(expenseAccounts.chartofaccounts).map((a) => ({
        account_id: a.account_id, account_name: a.account_name,
      })),
      equityAccounts: list<{ account_id: string; account_name: string }>(equityAccounts.chartofaccounts).map((a) => ({
        account_id: a.account_id, account_name: a.account_name,
      })),
      bankAccounts: list<{ account_id: string; account_name: string; account_number?: string; currency_code?: string }>(
        bankAccounts.bankaccounts,
      ).map((a) => ({
        account_id: a.account_id, account_name: a.account_name,
        account_number: a.account_number, currency_code: a.currency_code,
      })),
      taxes: list<{ tax_id: string; tax_name: string; tax_percentage: number }>(taxes.taxes).map((t) => ({
        tax_id: t.tax_id, tax_name: t.tax_name, tax_percentage: t.tax_percentage,
      })),
      fetchedAt: new Date().toISOString(),
    };

    cache = { at: Date.now(), data };
    return NextResponse.json({ ...data, cached: false });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
