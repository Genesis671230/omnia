import { AsyncLocalStorage } from "node:async_hooks";

/* Which Zoho Books organisation the current request is working in.
 *
 * Kept dependency-free on purpose: zoho-throttle reads it for the per-org
 * quota and zoho-org sets it, and each imports the other's neighbour.
 *
 * No scope = the default organisation from env vars (ZOHO_ORGANIZATION_ID),
 * i.e. exactly what every caller did before multi-org existed. Enter another
 * organisation only through withZohoOrg() in lib/integrations/zoho-org.ts. */

export const ENV_CONNECTION_ID = "env";

export type ZohoOrgScope = {
  connectionId: string;
  orgId: string;
  label: string;
  dailyBudget: number;
  /** e.g. https://www.zohoapis.com or https://www.zohoapis.sa (data centre). */
  apiDomain?: string;
};

const als = new AsyncLocalStorage<ZohoOrgScope>();

export function currentZohoScope(): ZohoOrgScope | undefined {
  return als.getStore();
}

/** The organisation_id every Zoho call in this request must use. */
export function zohoOrgId(): string {
  return als.getStore()?.orgId ?? process.env.ZOHO_ORGANIZATION_ID ?? "";
}

/** The connection id in effect ("env" for the default organisation). */
export function zohoConnectionId(): string {
  return als.getStore()?.connectionId ?? ENV_CONNECTION_ID;
}

/** Books API base for the organisation in scope — follows its data centre. */
export function zohoBooksBase(): string {
  return `${als.getStore()?.apiDomain || "https://www.zohoapis.com"}/books/v3`;
}

export function runInZohoScope<T>(scope: ZohoOrgScope, fn: () => Promise<T>): Promise<T> {
  return als.run(scope, fn);
}
