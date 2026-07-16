import { NextResponse } from "next/server";
import { zohoConfigured } from "@/lib/integrations/zoho";
import { getShopifyStores } from "@/lib/integrations/shopify";
import { wooConfigured } from "@/lib/integrations/woo";
import { syncZohoAndInventory } from "@/lib/zoho-sync";
import { ZohoSyncRunsRepository } from "@/lib/repositories/zoho-sync-runs.repository";

// Zoho's item/order pagination plus per-store Shopify GraphQL and Woo REST
// pagination can run well past a minute on a full sync (tens of thousands
// of rows) — give the manual trigger the same Pro-plan ceiling as /api/sync.
export const maxDuration = 300;

// GET /api/integrations/zoho — which sources are configured, plus the most
// recent run of the persistent Zoho/inventory-sync scheduler (manual or
// automatic) so the UI can show founders when inventory data was last pulled.
export async function GET() {
  const lastRun = await ZohoSyncRunsRepository.getLatest();
  return NextResponse.json({
    zoho: zohoConfigured(),
    shopify: getShopifyStores().map((s) => s.code),
    woo: wooConfigured(),
    lastRun,
  });
}

// POST /api/integrations/zoho — pull Zoho items/orders and live Shopify/Woo
// stock on demand. Also used by the scheduler internally via
// syncZohoAndInventory directly.
export async function POST() {
  const sourceResults = await syncZohoAndInventory();
  await ZohoSyncRunsRepository.record({ trigger: "manual", sourceResults });

  if (sourceResults.length === 0) {
    return NextResponse.json({
      results: [],
      message: "No sources configured — set ZOHO_REFRESH_TOKEN/ZOHO_CLIENT_ID/ZOHO_CLIENT_SECRET/ZOHO_ORGANIZATION_ID, SHOPIFY_*_URL/TOKEN, or WOO_URL/WOO_CONSUMER_KEY/WOO_CONSUMER_SECRET in .env.",
    });
  }

  return NextResponse.json({ results: sourceResults });
}
