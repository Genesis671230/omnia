import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";

export const maxDuration = 60;

const BOOKS_BASE = process.env.ZOHO_BOOKS_BASE ?? "https://www.zohoapis.com/books/v3";
const ORG_ID = process.env.ZOHO_ORGANIZATION_ID ?? "";
const CACHE_TTL_MS = 5 * 60 * 1000;


let cache: { at: number; data: any } | null = null;


async function fetchTaxes(path: string, token: string, query: Record<string, string> = {}) {

  try {
    
    
    const url = new URL(`https://www.zohoapis.com/books/v3/settings/taxes`);
    // url.searchParams.set("organization_id", ORG_ID);
    // for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(`https://www.zohoapis.com/books/v3/settings/taxes?organization_id=${ORG_ID}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const json = await res.json().catch((e) => {
      console.log(e,"gt error ")
    });
    
    // if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    //   throw new Error(json.message || `Zoho ${path} failed HTTP ${res.status}`);
    // }
    return json;
  } catch (error) {
    console.log(error,"here is error of fetchzoho")
  }
}
async function fetchZoho(path: string, token: string, query: Record<string, string> = {}) {

  try {
    
    
    const url = new URL(`${BOOKS_BASE}${path}`);
    url.searchParams.set("organization_id", ORG_ID);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const json = await res.json().catch((e) => {
      console.log(e,"gt error ")
    });
    
    // if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    //   throw new Error(json.message || `Zoho ${path} failed HTTP ${res.status}`);
    // }
    return json;
  } catch (error) {
    console.log(error,"here is error of fetchzoho")
  }
}

export async function GET(request: Request) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });

  // const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  // if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
  //   return NextResponse.json({ ...cache.data, cached: true });
  // }

  try {

    const token = await getAccessToken();
    // Chart of accounts pulled twice (Expense + Equity filters) so the dropdowns
    // stay tight — otherwise we'd load thousands of irrelevant accounts.
    
    const [expenseAccounts, equityAccounts, bankAccounts] = await Promise.all([
      fetchZoho("/chartofaccounts", token, { filter_by: "AccountType.Expense" }),
      fetchZoho("/chartofaccounts", token, { filter_by: "AccountType.Equity" }),
      fetchZoho("/bankaccounts", token),
    ]);

    
    const taxes = await fetchTaxes("/settings/taxes", token)



    const data = {
      expenseAccounts: (expenseAccounts.chartofaccounts ?? []).map((a: any) => ({
        account_id: a.account_id, account_name: a.account_name,
      })),
      equityAccounts: (equityAccounts.chartofaccounts ?? []).map((a: any) => ({
        account_id: a.account_id, account_name: a.account_name,
      })),
      bankAccounts: (bankAccounts.bankaccounts ?? []).map((a: any) => ({
        account_id: a.account_id, account_name: a.account_name,
        account_number: a.account_number, currency_code: a.currency_code,
      })),
      taxes: (taxes?.taxes).map((t: any) => ({
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