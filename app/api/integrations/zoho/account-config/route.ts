import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import {
  accountMapFromEnvPartial,
  BANK_LINE_KINDS,
  fetchZohoBankAccounts,
  fetchZohoChartOfAccounts,
  mergeAccountMaps,
  missingExpenseMappingFor,
  missingIncomeMapping,
  missingMappingFor,
} from "@/lib/integrations/zoho-banking";
import { ZohoConfigRepository } from "@/lib/repositories/zoho-config.repository";

export const maxDuration = 60;

const GATEWAYS = ["Stripe", "Tabby", "Tamara", "Checkout", "COD", "Telr"];

// GET /api/integrations/zoho/account-config
export async function GET() {
  if (!zohoConfigured()) {
    return NextResponse.json(
      { error: "Zoho is not configured — set ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_ORGANIZATION_ID" },
      { status: 503 },
    );
  }

  const saved = await ZohoConfigRepository.getAccountMap();
  const effective = mergeAccountMaps(accountMapFromEnvPartial(), saved);

  let bankAccounts: Awaited<ReturnType<typeof fetchZohoBankAccounts>> = [];
  let allAccounts: Awaited<ReturnType<typeof fetchZohoChartOfAccounts>> = [];
  let fetchError: string | null = null;
  try {
    const token = await getAccessToken();
    [bankAccounts, allAccounts] = await Promise.all([
      fetchZohoBankAccounts(token),
      fetchZohoChartOfAccounts(token),
    ]);
  } catch (e) {
    fetchError = (e as Error).message;
  }

  return NextResponse.json({
    gateways: GATEWAYS,
    bankLineKinds: BANK_LINE_KINDS,
    bankAccounts,
    allAccounts,
    saved,
    effective,
    readiness: GATEWAYS.map((g) => ({ gateway: g, missing: missingMappingFor(g, effective) })),
    incomeReadiness: missingIncomeMapping(effective),
    kindReadiness: BANK_LINE_KINDS.map((k) => ({ kind: k, missing: missingExpenseMappingFor(k, effective) })),
    fetchError,
  });
}

// POST — body: { bankAccountId, feeAccountId, clearingByGateway, defaultIncomeAccountId, expenseAccountByKind, actor? }
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const bankAccountId = String(body.bankAccountId ?? "");
  const feeAccountId = String(body.feeAccountId ?? "");
  const clearingByGateway = (body.clearingByGateway ?? {}) as Record<string, string>;
  const defaultIncomeAccountId = String(body.defaultIncomeAccountId ?? "");
  const expenseAccountByKind = (body.expenseAccountByKind ?? {}) as Record<string, string>;

  if (typeof clearingByGateway !== "object" || Array.isArray(clearingByGateway)) {
    return NextResponse.json({ error: "clearingByGateway must be an object of gateway → account id" }, { status: 400 });
  }
  if (typeof expenseAccountByKind !== "object" || Array.isArray(expenseAccountByKind)) {
    return NextResponse.json({ error: "expenseAccountByKind must be an object of kind → account id" }, { status: 400 });
  }

  const cleanObject = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string" && v.trim() !== ""));
  const cleanedClearing = cleanObject(clearingByGateway);
  const cleanedExpense = cleanObject(expenseAccountByKind);

  try {
    await ZohoConfigRepository.saveAccountMap(
      {
        bankAccountId,
        feeAccountId,
        clearingByGateway: cleanedClearing,
        defaultIncomeAccountId,
        expenseAccountByKind: cleanedExpense,
      },
      String(body.actor ?? "founder"),
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const effective = mergeAccountMaps(accountMapFromEnvPartial(), {
    bankAccountId, feeAccountId, clearingByGateway: cleanedClearing,
    defaultIncomeAccountId, expenseAccountByKind: cleanedExpense,
  });
  return NextResponse.json({
    ok: true,
    effective,
    readiness: GATEWAYS.map((g) => ({ gateway: g, missing: missingMappingFor(g, effective) })),
    incomeReadiness: missingIncomeMapping(effective),
    kindReadiness: BANK_LINE_KINDS.map((k) => ({ kind: k, missing: missingExpenseMappingFor(k, effective) })),
  });
}
