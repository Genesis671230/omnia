import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { peekSetting } from "@/lib/settings";
import { ORDERS_QUERY, type ShopifyRawOrder } from "@/lib/integrations/shopify";
import { normalizeShopifyOrder } from "@/lib/normalize/order";
import { postForm, postJson } from "./http";
import { isShopDomain, verifyShopifyHmac } from "./oauth";
import { registerConnector } from "./registry";
import { GrantRevokedError, OAuthFlowError, type ConnectorDef, type Grant } from "./types";

/* Shopify. One connection per store. Four ways in:
 *   platform / own_app + authorization_code → offline token, never expires
 *   own_app + client_credentials           → Dev Dashboard app in the same
 *                                             organisation as the store; 24 h token
 *   token                                   → legacy custom-app shpat_ token
 * (Shopify stopped allowing NEW legacy custom apps on 2026-01-01; existing
 * ones keep working.) Every connection owns a `stores` row — orders.store_id
 * has a foreign key to it, and a store without one syncs zero orders. */

export const SHOPIFY_SCOPES = [
  "read_orders", "read_all_orders", "read_products", "read_inventory", "write_inventory",
  "read_customers", "read_shopify_payments_payouts", "read_reports",
];

const configSchema = z.object({
  store_id: z.string().regex(/^[A-Z0-9_]+$/, "Store code: capitals, digits, underscore"),
  shop: z.string().refine(isShopDomain, "Must be xxx.myshopify.com"),
  shop_name: z.string().default(""),
  currency: z.string().default(""),
  timezone: z.string().default(""),
  /** Empty = the workspace setting shopify.api_version. */
  api_version: z.string().default(""),
  webhook_topics: z.array(z.string()).default(["ORDERS_CREATE", "ORDERS_PAID", "INVENTORY_LEVELS_UPDATE"]),
});
export type ShopifyConfig = z.infer<typeof configSchema>;

const secretsSchema = z.object({
  client_id: z.string().optional(), client_secret: z.string().optional(), access_token: z.string().optional(),
  access_token_expires_at: z.number().optional(), webhook_secret: z.string().optional(),
  refresh_token: z.string().optional(), grant_id: z.string().optional(),
});
type ShopifySecrets = z.infer<typeof secretsSchema>;

const version = (c?: { api_version?: string } | null) => c?.api_version || peekSetting<string>("shopify.api_version");

/** One Admin GraphQL call. 401/403 = the token is dead (app uninstalled or
 *  token revoked) → GrantRevokedError; anything else is a plain error. */
export async function shopifyGraphql(shop: string, token: string, apiVersion: string, query: string, variables: object = {}) {
  const { status, json } = await postJson(`https://${shop}/admin/api/${apiVersion}/graphql.json`, { query, variables }, { "X-Shopify-Access-Token": token });
  if (status === 401 || status === 403) throw new GrantRevokedError(`Shopify ${shop}: HTTP ${status}`);
  if (status !== 200 || json.errors) throw new Error(`Shopify ${shop} GraphQL failed HTTP ${status}: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
  return json.data;
}

function shopOf(params: Record<string, string>): string {
  const shop = (params.shop ?? "").trim().toLowerCase();
  if (!isShopDomain(shop)) throw new OAuthFlowError("bad_host", `"${params.shop ?? ""}" is not a xxx.myshopify.com domain`);
  return shop;
}

async function tokenRequest(shop: string, body: Record<string, string>, kind: "code" | "credentials"): Promise<Grant> {
  const { status, json } = await postForm(`https://${shop}/admin/oauth/access_token`, body);
  if (!json?.access_token) {
    const why = json?.error_description ?? json?.error ?? `HTTP ${status}`;
    // A rejected client-credentials request means the app is gone or no longer
    // installed — the connection needs the user. A rejected code is just a
    // failed connect attempt.
    if (kind === "credentials" && (status === 400 || status === 401 || status === 403)) throw new GrantRevokedError(`Shopify ${shop}: ${why}`);
    throw new OAuthFlowError("exchange_failed", `Shopify token request failed: ${why}`);
  }
  return {
    accessToken: json.access_token,
    scopes: json.scope,
    expiresAt: json.expires_in ? Date.now() + Number(json.expires_in) * 1000 : undefined,
    raw: { shop },
  };
}

const SHOP_QUERY = `{ shop { name currencyCode ianaTimezone myshopifyDomain } currentAppInstallation { accessScopes { handle } } }`;
const WEBHOOK_PATHS: Record<string, string> = { ORDERS_CREATE: "orders-create", ORDERS_PAID: "orders-paid", INVENTORY_LEVELS_UPDATE: "inventory-update" };

export const shopifyConnector: ConnectorDef<ShopifyConfig, ShopifySecrets> = {
  provider: "shopify",
  label: "Shopify",
  category: "store",
  authModes: ["platform", "own_app", "token"],
  grantTypes: { platform: ["authorization_code"], own_app: ["authorization_code", "client_credentials"], token: ["static_token"] },
  configSchema,
  secretsSchema,
  configFields: [
    { key: "store_id", label: "Store code", kind: "text", help: "Used on orders, e.g. UAE" },
    { key: "api_version", label: "API version override", kind: "text", help: "Empty = workspace default" },
  ],
  startParams: [
    { key: "shop", label: "Shop domain", pattern: "^[a-z0-9][a-z0-9-]*\\.myshopify\\.com$" },
    { key: "store_id", label: "Store code", pattern: "^[A-Z0-9_]+$" },
  ],
  oauth: {
    authorizeUrl({ state, redirectUri, app, params }) {
      const q = new URLSearchParams({ client_id: app.clientId, scope: SHOPIFY_SCOPES.join(","), redirect_uri: redirectUri, state });
      return `https://${shopOf(params)}/admin/oauth/authorize?${q}`;
    },
    async exchangeCode({ code, app, params }) {
      return tokenRequest(shopOf(params), { client_id: app.clientId, client_secret: app.clientSecret, code }, "code");
    },
    async refresh(_secrets, config, app) {
      // Only client-credentials tokens expire; re-mint them the same way.
      return tokenRequest(config.shop, { client_id: app.clientId, client_secret: app.clientSecret, grant_type: "client_credentials" }, "credentials");
    },
    async clientCredentials(app, config, params) {
      const shop = config?.shop ?? shopOf(params);
      return tokenRequest(shop, { client_id: app.clientId, client_secret: app.clientSecret, grant_type: "client_credentials" }, "credentials");
    },
  },
  verifyCallback(query, app, params) {
    if ((query.get("shop") ?? "").toLowerCase() !== shopOf(params)) throw new OAuthFlowError("bad_host", "Callback shop differs from the shop you started with");
    if (!verifyShopifyHmac(query, app.clientSecret)) throw new OAuthFlowError("bad_hmac", "Shopify callback signature is invalid");
  },
  async accountsFromGrant(grant, _app, params) {
    const shop = shopOf(params);
    const d = await shopifyGraphql(shop, grant.accessToken, version(), SHOP_QUERY);
    return [{
      accountRef: shop,
      label: d.shop.name,
      config: { store_id: params.store_id, shop, shop_name: d.shop.name, currency: d.shop.currencyCode, timezone: d.shop.ianaTimezone },
      scopes: (d.currentAppInstallation?.accessScopes ?? []).map((s: any) => s.handle).join(","),
    }];
  },
  async test(conn, token) {
    const d = await shopifyGraphql(conn.config.shop, token, version(conn.config), SHOP_QUERY);
    const granted: string[] = (d.currentAppInstallation?.accessScopes ?? []).map((s: any) => s.handle);
    const missingScopes = SHOPIFY_SCOPES.filter((s) => !granted.includes(s) && !(s.startsWith("read_") && granted.includes(s.replace("read_", "write_"))));
    return { ok: true, accountName: d.shop.name, scopes: granted.join(","), missingScopes };
  },
  async onConnect(conn, token) {
    const { data: existing, error: readErr } = await supabase.from("stores").select("id").eq("store_id", conn.config.store_id).maybeSingle();
    if (readErr) throw new Error(`stores read failed: ${readErr.message}`);
    const row = {
      store_id: conn.config.store_id, platform: "shopify", domain: conn.config.shop,
      currency: conn.config.currency || "AED", timezone: conn.config.timezone || "Asia/Dubai",
    };
    const { error } = existing
      ? await supabase.from("stores").update(row).eq("id", existing.id)
      : await supabase.from("stores").insert({ id: randomUUID(), ...row });
    if (error) throw new Error(`stores upsert failed: ${error.message}`);
    if (conn.authMode === "token") return; // legacy custom apps keep the webhooks configured in the Shopify admin
    const base = String(peekSetting<string>("app.public_url")).replace(/\/+$/, "");
    for (const topic of conn.config.webhook_topics) {
      const path = WEBHOOK_PATHS[topic];
      if (!path) continue;
      const d = await shopifyGraphql(conn.config.shop, token, version(conn.config),
        `mutation($t: WebhookSubscriptionTopic!, $u: URL!) { webhookSubscriptionCreate(topic: $t, webhookSubscription: { callbackUrl: $u, format: JSON }) { userErrors { message } } }`,
        { t: topic, u: `${base}/api/webhooks/shopify/${conn.config.store_id}/${path}` });
      const errs: { message: string }[] = d?.webhookSubscriptionCreate?.userErrors ?? [];
      // Re-connecting a store finds its webhooks already there — that's fine.
      const real = errs.filter((e) => !/already been taken|already exists/i.test(e.message));
      if (real.length) throw new Error(`Webhook ${topic}: ${real.map((e) => e.message).join("; ")}`);
    }
  },
  async references(conn) {
    const { count, error } = await supabase.from("orders").select("*", { count: "exact", head: true }).eq("store_id", conn.config.store_id);
    if (error) throw new Error(`Checking orders failed: ${error.message}`);
    return count ? [`${count} orders (disable instead — order history stays)`] : [];
  },
  async listOrders(conn, token, { since, limit }) {
    const d = await shopifyGraphql(conn.config.shop, token, version(conn.config), ORDERS_QUERY, {
      first: Math.min(Math.max(limit, 1), 50), after: null, query: since ? `updated_at:>='${since}'` : null,
    });
    return ((d.orders?.nodes ?? []) as ShopifyRawOrder[]).map((o) => normalizeShopifyOrder(o, conn.config.store_id));
  },
};

registerConnector(shopifyConnector);
