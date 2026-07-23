import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import {
  accountMapFromEnvPartial,
  fetchZohoBankAccounts,
  fetchZohoChartOfAccounts,
  mergeAccountMaps,
  missingMappingFor,
} from "@/lib/integrations/zoho-banking";
import { ZohoConfigRepository } from "@/lib/repositories/zoho-config.repository";

export const maxDuration = 60;

// Gateways that can hold money on our behalf, and therefore need a clearing
// account. Kept here rather than derived from live recon lines so the mapping
// screen is complete before the first payout of a new gateway ever arrives.
const GATEWAYS = ["Stripe", "Tabby", "Tamara", "Checkout", "COD", "Telr"];

// GET /api/integrations/zoho/account-config
//
// Everything the Settings mapping screen needs in one call: the accounts Zoho
// will accept, the mapping in force right now, and what is still missing.
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
    // Both lists: transfer legs must be bank-type accounts, but the fee side
    // is an expense account and appears only in the chart of accounts.
    [bankAccounts, allAccounts] = await Promise.all([
      fetchZohoBankAccounts(token),
      fetchZohoChartOfAccounts(token),
    ]);
  } catch (e) {
    // Reported rather than thrown: the saved mapping is still worth showing
    // when Zoho is unreachable or the token lacks the banking scopes.
    fetchError = (e as Error).message;
  }

  return NextResponse.json({
    gateways: GATEWAYS,
    bankAccounts,
    allAccounts,
    saved,
    effective,
    // Per gateway, so the UI can mark exactly which rows block a post.
    readiness: GATEWAYS.map((g) => ({ gateway: g, missing: missingMappingFor(g, effective) })),
    fetchError,
  });
}

// POST — body: { bankAccountId, feeAccountId, clearingByGateway, actor? }
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const bankAccountId = String(body.bankAccountId ?? "");
  const feeAccountId = String(body.feeAccountId ?? "");
  const clearingByGateway = (body.clearingByGateway ?? {}) as Record<string, string>;

  if (typeof clearingByGateway !== "object" || Array.isArray(clearingByGateway)) {
    return NextResponse.json({ error: "clearingByGateway must be an object of gateway → account id" }, { status: 400 });
  }

  // Blank entries are dropped rather than saved: an empty string stored in the
  // DB would beat a working env fallback under the merge rule and silently
  // unmap a gateway.
  const cleaned = Object.fromEntries(
    Object.entries(clearingByGateway).filter(([, v]) => typeof v === "string" && v.trim() !== ""),
  );

  try {
    await ZohoConfigRepository.saveAccountMap(
      { bankAccountId, feeAccountId, clearingByGateway: cleaned },
      String(body.actor ?? "founder"),
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const effective = mergeAccountMaps(accountMapFromEnvPartial(), {
    bankAccountId, feeAccountId, clearingByGateway: cleaned,
  });
  return NextResponse.json({
    ok: true,
    effective,
    readiness: GATEWAYS.map((g) => ({ gateway: g, missing: missingMappingFor(g, effective) })),
  });
}
