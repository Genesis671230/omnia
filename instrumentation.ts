// Next.js server-boot hook (stable since Next 15) — starts the persistent
// payout-verification, ad-platform-sync, Zoho/inventory-sync, order-sync,
// gateway payment-confirmation (Stripe + Telr), CFO digest, group-summary,
// and Telegram-listener schedulers exactly once when the Node server
// process comes up. Not invoked in the edge runtime or during build.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPayoutSyncScheduler } = await import("@/lib/scheduler/payout-sync-scheduler");
    startPayoutSyncScheduler();

    const { startAdSyncScheduler } = await import("@/lib/scheduler/ad-sync-scheduler");
    startAdSyncScheduler();

    const { startZohoSyncScheduler } = await import("@/lib/scheduler/zoho-sync-scheduler");
    startZohoSyncScheduler();

    const { startOrderSyncScheduler } = await import("@/lib/scheduler/order-sync-scheduler");
    startOrderSyncScheduler();

    const { startPaymentConfirmScheduler } = await import("@/lib/scheduler/payment-confirm-scheduler");
    startPaymentConfirmScheduler();

    const { startCfoDigestScheduler } = await import("@/lib/scheduler/cfo-digest-scheduler");
    startCfoDigestScheduler();

    const { startGroupSummaryScheduler } = await import("@/lib/scheduler/group-summary-scheduler");
    startGroupSummaryScheduler();

    const { startTelegramListeners } = await import("@/lib/scheduler/telegram-listener-scheduler");
    startTelegramListeners();
  }
}
