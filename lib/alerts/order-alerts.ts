// New-order → Telegram alerts. Fires once per order — dedup rides the same
// webhook_inbox ledger the webhook handlers use (provider="telegram-order-alert",
// webhook_id=order uid), so re-syncing the default 60-day window never
// reposts an order that already went out.

import { supabase } from "@/lib/supabase";
import { alreadyProcessed } from "@/lib/webhook-plumbing";
import { sendTelegramMessage, telegramConfigured } from "@/lib/integrations/telegram";
import { googleSheetsConfigured } from "@/lib/integrations/google-sheets";
import { appendOrderToDispatchSheet, getExistingOrderNumbers, tabForOrder } from "@/lib/integrations/dispatch-sheet";
import type { OrderRow } from "@/lib/normalize/order";

type SheetStatus = "added" | "already-in-sheet" | "failed" | null;

const STORE_LABELS: Record<string, string> = {
  WA: "Shopify WhatsApp",
  UAE: "Shopify UAE",
  KSA: "Shopify KSA",
  WOO: "WooCommerce",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Courier routing, per agentic/couriers.md — local (UAE) ships OnTrack,
// everything else ships SMSA/DHL international. Cutoffs are in shop time
// (Dubai, UTC+4, no DST) regardless of which store/timezone the order came
// from.
const DUBAI_OFFSET_MINUTES = 4 * 60;
const SMSA_CUTOFF_MINUTES = 13 * 60; // 1:00pm — after this, held for tomorrow
const ONTRACK_CUTOFF_MINUTES = 20 * 60 + 30; // 8:30pm

function minutesInDubaiDay(iso: string): number {
  const dubai = new Date(new Date(iso).getTime() + DUBAI_OFFSET_MINUTES * 60_000);
  return dubai.getUTCHours() * 60 + dubai.getUTCMinutes();
}

export function courierStatus(row: OrderRow): string {
  const minutes = minutesInDubaiDay(row.order_date);
  const isLocal = row.country === "AE";

  if (isLocal) {
    return minutes < ONTRACK_CUTOFF_MINUTES
      ? "🚚 OnTrack (local) — out for pickup tonight, cutoff 8:30pm — @Sinan"
      : "⏭️ OnTrack (local) — past 8:30pm cutoff, held for tomorrow's pickup — @Sinan";
  }
  return minutes < SMSA_CUTOFF_MINUTES
    ? "🚚 SMSA/DHL (international) — picked & packed by 3pm, out with courier today — @Yaseen"
    : "⏭️ SMSA/DHL (international) — past 1pm cutoff, held for tomorrow's pickup — @Yaseen";
}

// Shopify orders carry live variant stock at sync time; Woo orders don't
// (see OrderLineItem.stock comment), so those skus fall back to the last
// Zoho-synced available_stock — already in Supabase via the Zoho sync
// scheduler, no live Zoho API call needed on the alert path.
async function zohoStockBySku(skus: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const clean = [...new Set(skus.filter(Boolean))];
  if (clean.length === 0) return map;
  const { data, error } = await supabase.from("zoho_items").select("sku, available_stock").in("sku", clean);
  if (error) return map;
  for (const row of data ?? []) map.set(row.sku as string, Number(row.available_stock));
  return map;
}

export function formatOrderAlert(row: OrderRow, zohoStock: Map<string, number>, sheetStatus: SheetStatus = null): string {
  const store = STORE_LABELS[row.store_id] ?? row.store_id;
  const location = [row.city, row.country].filter(Boolean).join(", ");
  const amount =
    row.currency !== "AED"
      ? `${row.gross_aed.toFixed(2)} AED (${row.gross_original.toFixed(2)} ${row.currency})`
      : `${row.gross_aed.toFixed(2)} AED`;

  const lines = row.line_items.map((li) => {
    const stock = li.stock ?? (li.sku ? zohoStock.get(li.sku) : undefined);
    const stockLabel = stock == null ? "stock unknown" : stock <= 0 ? "OUT OF STOCK" : `${stock} left`;
    return `  • ${escapeHtml(li.title)} x${li.qty} — ${stockLabel}`;
  });

  return [
    `🛒 <b>New order — ${escapeHtml(store)}</b>`,
    `#${escapeHtml(row.order_number)} · ${escapeHtml(row.gateway)}`,
    row.customer_name ? escapeHtml(row.customer_name) : null,
    location || null,
    amount,
    lines.length ? lines.join("\n") : null,
    courierStatus(row),
    sheetStatus === "added" ? "📋 Added to dispatch sheet — needs payment confirmation — @Sinan" : null,
    sheetStatus === "failed" ? "⚠️ Dispatch sheet write failed — log this order manually" : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

// Sheet-push is tracked independently of the Telegram-alert dedup above —
// deliberately, so it can catch up a backlog (orders already Telegram-alerted
// before Sheets was configured, or before this tab's real name/columns were
// known) without re-announcing every order in the group, and so a transient
// Sheets failure retries next cycle without being tied to whether Telegram
// already succeeded.
async function pushToSheetIfNeeded(row: OrderRow, existingByTab: Map<string, Set<string>>): Promise<SheetStatus> {
  if (!googleSheetsConfigured()) return null;
  if (await alreadyProcessed("dispatch-sheet-write", row.uid)) return null; // already handled, nothing new to say

  const tab = tabForOrder(row);
  const existing = existingByTab.get(tab);
  if (existing?.has(row.order_number)) return "already-in-sheet"; // Sinan/Yaseen already has this row — don't duplicate, but do mark it seen

  try {
    await appendOrderToDispatchSheet(row);
    existing?.add(row.order_number); // keep this batch's view fresh so we don't double-append within the same run
    return "added";
  } catch (e) {
    console.error(`[order-alert] dispatch sheet write failed for ${row.uid}:`, (e as Error).message);
    await supabase.from("webhook_inbox").delete().eq("provider", "dispatch-sheet-write").eq("webhook_id", row.uid);
    return "failed";
  }
}

export async function sendNewOrderAlerts(rows: OrderRow[]): Promise<void> {
  if (rows.length === 0) return;

  const missingStockSkus = rows.flatMap((r) => r.line_items.filter((li) => li.stock == null).map((li) => li.sku));
  const zohoStock = await zohoStockBySku(missingStockSkus);

  const existingByTab = new Map<string, Set<string>>();
  if (googleSheetsConfigured()) {
    for (const tab of new Set(rows.map(tabForOrder))) {
      try {
        existingByTab.set(tab, await getExistingOrderNumbers(tab));
      } catch (e) {
        console.error(`[order-alert] failed to read existing sheet rows for ${tab}:`, (e as Error).message);
      }
    }
  }

  for (const row of rows) {
    const sheetStatus = await pushToSheetIfNeeded(row, existingByTab);

    // Insert-based check-and-mark: already returns true (skip) if another
    // process alerted this uid first, same race-safety as the webhook dedup.
    // Mark BEFORE sending to close that race — but a send that then fails
    // (e.g. Telegram rate limit) must roll the mark back, or the order is
    // silently never alerted again.
    const alreadyAlerted = telegramConfigured() && (await alreadyProcessed("telegram-order-alert", row.uid));

    if (alreadyAlerted) {
      // The main alert already went out earlier — only speak up now if the
      // sheet backfill just now caught this order up, or if it just failed
      // again. Without this, a retry failure only ever hits console.error —
      // invisible to Sinan/Yaseen, who only watch the Telegram group — so an
      // order can silently never make it into the sheet at all.
      if (sheetStatus === "added" || sheetStatus === "failed") {
        const message =
          sheetStatus === "added"
            ? `📋 <b>Backfilled to dispatch sheet</b> — #${escapeHtml(row.order_number)} — needs payment confirmation — @Sinan`
            : `⚠️ <b>Dispatch sheet write failed again</b> — #${escapeHtml(row.order_number)} — log this order manually — @Sinan`;
        const result = await sendTelegramMessage(message);
        if (result.ok) await new Promise((resolve) => setTimeout(resolve, 1100));
      }
      continue;
    }

    if (!telegramConfigured()) continue;
    // alreadyAlerted's alreadyProcessed() call above already marked this uid
    // as processed (that's the point of the check-and-mark pattern) — a
    // second call here would just find its own mark and wrongly skip a
    // genuinely new order, so we send unconditionally in this branch.

    const result = await sendTelegramMessage(formatOrderAlert(row, zohoStock, sheetStatus));
    if (!result.ok) {
      console.error(`[order-alert] failed to post ${row.uid}: ${result.error}`);
      await supabase.from("webhook_inbox").delete().eq("provider", "telegram-order-alert").eq("webhook_id", row.uid);
      continue;
    }

    // Telegram allows roughly 1 message/sec per chat before 429-ing — a
    // backlog of dozens of orders in one sync cycle would otherwise blow
    // through that and drop most of them.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
}
