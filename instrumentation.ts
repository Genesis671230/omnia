// Next.js server-boot hook (stable since Next 15) — starts the persistent
// payout-verification, ad-platform-sync, and Zoho/inventory-sync schedulers
// exactly once when the Node server process comes up. Not invoked in the
// edge runtime or during build.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPayoutSyncScheduler } = await import("@/lib/scheduler/payout-sync-scheduler");
    startPayoutSyncScheduler();

    const { startAdSyncScheduler } = await import("@/lib/scheduler/ad-sync-scheduler");
    startAdSyncScheduler();

    const { startZohoSyncScheduler } = await import("@/lib/scheduler/zoho-sync-scheduler");
    startZohoSyncScheduler();
  }
}
