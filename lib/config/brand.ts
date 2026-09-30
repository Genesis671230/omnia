/* Per-deployment branding. Each client runs its own copy of the platform
 * (docs/new-client-deployment.md); these env vars are all that differ in the
 * UI. Defaults are Omnia's, so this deployment is unchanged. NEXT_PUBLIC_ so
 * client components can read them. */

export const BRAND = {
  /** Company name in titles and the sidebar, e.g. "Omnia", "Sweet Dream". */
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "Omnia",
  /** Product line under the name. */
  product: process.env.NEXT_PUBLIC_BRAND_PRODUCT || "Finance OS",
  /** One-line description for <meta name="description">. */
  description:
    process.env.NEXT_PUBLIC_BRAND_DESCRIPTION ||
    "Bank-grounded financial operations for Omnia Stores across UAE, KSA, WhatsApp, and WooCommerce.",
};

export const brandTitle = `${BRAND.name} ${BRAND.product}`;
export const brandInitial = BRAND.name.trim().charAt(0).toUpperCase() || "O";
