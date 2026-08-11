// Shared "confirm this order got paid" tail — the part every gateway
// confirmation flow does identically once it has a candidate amount/date to
// check against an order: verify the amount is close enough to trust
// (lib/sync/payment-match-tolerance.ts), dedup, flip financial_status,
// fill in the dispatch sheet's payment-confirmation columns (the one place
// automation is allowed to touch them — see markOrderPaidInSheet), and tell
// the Telegram group who paid. Used by lib/sync/stripe-payment-confirm.ts,
// lib/sync/telr-payment-confirm.ts, and app/api/payments/confirm/route.ts
// (for n8n-driven confirmations — Tamara/Tabby/Checkout/OnTrack COD, parsed
// from forwarded gateway emails, where the actual email parsing is n8n's
// job, not this codebase's).
//
// Deliberately has ZERO dependency on the AI/Anthropic chat stack — every
// gateway confirmation (Stripe, Telr, and whatever n8n calls in through the
// API route) runs on plain deterministic TypeScript + Supabase + the Sheets
// and Telegram REST APIs. If ANTHROPIC_API_KEY is missing, unset, or rate
// limited, none of this is affected — only the @mention chat bot's Q&A
// degrades. Keep it that way: never add an LLM call anywhere in this file
// or its callers' confirm path.

import { supabase } from "@/lib/supabase";
import { markOrderPaidInSheet, type MarkPaidResult } from "@/lib/integrations/dispatch-sheet";
import { sendTelegramMessage, telegramConfigured } from "@/lib/integrations/telegram";
import { alreadyProcessed } from "@/lib/webhook-plumbing";
import { amountWithinTolerance } from "@/lib/sync/payment-match-tolerance";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type ConfirmPaymentOrder = {
  uid: string;
  order_number: string;
  country: string;
  customer_name: string;
  gross_original: number;
};

export type ConfirmPaymentInput = {
  order: ConfirmPaymentOrder;
  source: string; // "Stripe" | "Telr" | "Tamara" | "Tabby" | "Checkout" | "OnTrack" | ...
  dedupProvider: string; // e.g. "stripe-payment-confirm", "gmail-tamara-confirm"
  amount: number;
  currency: string;
  paidAtIso: string;
};

export type ConfirmPaymentOutcome =
  | { status: "confirmed"; sheetResult: MarkPaidResult }
  | { status: "amount-mismatch"; expected: number; actual: number }
  | { status: "already-processed" }
  | { status: "financial-status-update-failed"; error: string };

export async function confirmOrderPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentOutcome> {
  if (!amountWithinTolerance(input.amount, input.order.gross_original)) {
    return { status: "amount-mismatch", expected: input.order.gross_original, actual: input.amount };
  }

  if (await alreadyProcessed(input.dedupProvider, input.order.uid)) {
    return { status: "already-processed" };
  }

  const { error } = await supabase.from("orders").update({ financial_status: "paid" }).eq("uid", input.order.uid);
  if (error) {
    return { status: "financial-status-update-failed", error: error.message };
  }

  let sheetResult: MarkPaidResult = null;
  try {
    sheetResult = await markOrderPaidInSheet(input.order, input.paidAtIso, input.source);
  } catch (e) {
    console.error(`[payment-confirm] dispatch sheet mark-paid failed for ${input.order.uid}:`, (e as Error).message);
  }

  if (telegramConfigured()) {
    // "updated" is the only outcome where the sheet actually changed — every
    // other outcome (not-in-sheet, a blocked/misconfigured tab, or a thrown
    // error) must read as "go check manually," never as silent success, or
    // Sinan/Yaseen will trust a sheet that was never touched.
    const sheetNote = sheetResult === "updated" ? " — marked paid in dispatch sheet" : " — could not confirm in dispatch sheet, log manually";
    const result = await sendTelegramMessage(
      `💰 <b>Payment received</b> — #${escapeHtml(input.order.order_number)} — ${escapeHtml(input.order.customer_name || "customer")} — ` +
        `${input.amount.toFixed(2)} ${input.currency} via ${input.source}${sheetNote} — @Sinan`,
    );
    if (result.ok) await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  return { status: "confirmed", sheetResult };
}
