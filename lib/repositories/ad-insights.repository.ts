import { supabase } from "@/lib/supabase";
import type { NormalizedInsight } from "@/lib/integrations/ads/types";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type AdInsightRow = {
  campaign_id: string;
  platform: string;
  account_id: string;
  store_id: string;
  campaign_name: string;
  campaign_status: string;
  date: string;
  spend: number;
  currency: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  landing_page_views: number;
  view_content: number;
  add_to_cart: number;
  initiate_checkout: number;
};

export const AdInsightsRepository = {
  // Upserts campaign metadata + the daily insight row for each entry.
  // campaign_id is `platform:campaignId`; insight id is `campaignId|date` —
  // re-running a sync for the same campaign+day updates values in place
  // rather than duplicating rows.
  async upsertInsights(rows: (NormalizedInsight & { store: string })[]): Promise<number> {
    if (rows.length === 0) return 0;

    const campaignsById = new Map<string, {
      id: string; tenant_id: string; platform: string; account_id: string;
      store_id: string; name: string; status: string;
    }>();
    for (const r of rows) {
      const id = `${r.platform}:${r.campaignId}`;
      campaignsById.set(id, {
        id, tenant_id: TENANT, platform: r.platform, account_id: r.accountId,
        store_id: r.store, name: r.campaignName, status: r.campaignStatus,
      });
    }
    const { error: campErr } = await supabase
      .from("ad_campaigns")
      .upsert([...campaignsById.values()], { onConflict: "id" });
    if (campErr) throw new Error(`ad_campaigns upsert failed: ${campErr.message}`);

    const insightRows = rows.map((r) => {
      const campaignId = `${r.platform}:${r.campaignId}`;
      return {
        id: `${campaignId}|${r.date}`,
        campaign_id: campaignId,
        date: r.date,
        spend: r.spend,
        currency: r.currency,
        impressions: r.impressions,
        clicks: r.clicks,
        conversions: r.conversions,
        conversion_value: r.conversionValue,
        landing_page_views: r.landingPageViews ?? 0,
        view_content: r.viewContent ?? 0,
        add_to_cart: r.addToCart ?? 0,
        initiate_checkout: r.initiateCheckout ?? 0,
        synced_at: new Date().toISOString(),
      };
    });
    const { error: insErr } = await supabase
      .from("ad_insights")
      .upsert(insightRows, { onConflict: "id" });
    if (insErr) throw new Error(`ad_insights upsert failed: ${insErr.message}`);

    return insightRows.length;
  },

  // Flattened campaign+insight rows for a date window — the repository does
  // the join in JS rather than relying on a PostgREST embedded resource,
  // matching how the rest of this codebase's repositories work.
  async listInsights(fromDate: string, toDate: string): Promise<AdInsightRow[]> {
    const [{ data: campaigns, error: cErr }, { data: insights, error: iErr }] = await Promise.all([
      supabase.from("ad_campaigns").select("id, platform, account_id, store_id, name, status"),
      supabase
        .from("ad_insights")
        .select("campaign_id, date, spend, currency, impressions, clicks, conversions, conversion_value, landing_page_views, view_content, add_to_cart, initiate_checkout")
        .gte("date", fromDate)
        .lte("date", toDate)
        .limit(5000),
    ]);
    if (cErr) throw new Error(`ad_campaigns select failed: ${cErr.message}`);
    if (iErr) throw new Error(`ad_insights select failed: ${iErr.message}`);

    const campaignById = new Map((campaigns ?? []).map((c) => [c.id, c]));
    const rows: AdInsightRow[] = [];
    for (const ins of insights ?? []) {
      const camp = campaignById.get(ins.campaign_id);
      if (!camp) continue; // orphaned insight row (campaign since deleted) — skip
      rows.push({
        campaign_id: ins.campaign_id,
        platform: camp.platform,
        account_id: camp.account_id,
        store_id: camp.store_id,
        campaign_name: camp.name,
        campaign_status: camp.status,
        date: ins.date,
        spend: Number(ins.spend || 0),
        currency: ins.currency,
        impressions: Number(ins.impressions || 0),
        clicks: Number(ins.clicks || 0),
        conversions: Number(ins.conversions || 0),
        conversion_value: Number(ins.conversion_value || 0),
        landing_page_views: Number(ins.landing_page_views || 0),
        view_content: Number(ins.view_content || 0),
        add_to_cart: Number(ins.add_to_cart || 0),
        initiate_checkout: Number(ins.initiate_checkout || 0),
      });
    }
    return rows;
  },
};
