import { NextResponse } from "next/server";
import { markReconDirty } from "@/lib/reconciliation/snapshot";
import type { Gateway } from "@/lib/gateways";
import { parsePayoutFileAsync, type ParsedPayout } from "@/lib/parsers/payouts";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { FilesRepository } from "@/lib/repositories/files.repository";
import { supabase } from "@/lib/supabase";
import { assignShopifyStores } from "@/lib/finance/shopify-payout-store";

export const maxDuration = 60;

// POST /api/upload/payout — multipart form with `file`; `provider` is an
// optional hint. Format is auto-detected: Telr .xls/.csv, Tamara statement
// .xlsx, Tabby settlement .xlsx, Stripe reconciliation/transfers .csv, an
// OnTrack COD Client Payment Voucher .pdf, or a generic provider CSV. The raw file is stored for later download.
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const providerRaw = String(form.get("provider") || "");
  const provider = (["Stripe", "Telr", "Checkout", "Tabby", "Tamara", "Shopify Payments", "COD"].includes(providerRaw)
    ? providerRaw
    : undefined) as Gateway | undefined;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded (field name: file)" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let payouts: ParsedPayout[];
  try {
    payouts = await parsePayoutFileAsync(buf, file.name, provider);
    // A Shopify Payments export doesn't say which store it's from; the order
    // numbers in it do. Optional `store` form field overrides.
    payouts = await assignShopifyStores(payouts, String(form.get("store") || "").toUpperCase() || null);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }

  // A colliding statement number is stored under a disambiguated id (Tabby
  // reuses one number across every store it pays that day), so everything
  // downstream must act on the id the row actually claimed, not the parser's.
  const resolvedIds = await PayoutsRepository.upsertPayoutsWithIds(payouts);
  const storedId = (p: ParsedPayout) => resolvedIds.get(p.id) ?? p.id;
  const saved = resolvedIds.size;

  // Uploaded from a bank credit's own panel → attach it to that credit so it
  // lists there immediately, even if its total doesn't match (shows Variance).
  const bankLineId = String(form.get("bankLineId") || "");
  let pinnedTo: string | null = null;
  if (bankLineId && payouts.length === 1) {
    const { data: line } = await supabase
      .from("recon_lines")
      .select("confirmed_by, payout_id")
      .eq("bank_line_id", bankLineId)
      .maybeSingle();
    // A credit confirmed with no payout file is exactly the case that most
    // needs a file attached — it was confirmed on trust and has no proof — so
    // pinning is gated on the credit having no payout, never on it being
    // unconfirmed. Pinning to a credit that already has its payout would
    // silently swap the evidence under a settled row, so that stays refused.
    if (!line?.payout_id) {
      await PayoutsRepository.pinToBankLine([storedId(payouts[0])], bankLineId);
      pinnedTo = bankLineId;
    }
  }

  let fileId: string | null = null;
  try {
    fileId = await FilesRepository.save({
      kind: "payout",
      provider: payouts[0]?.provider ?? provider,
      filename: file.name,
      mime: file.type || undefined,
      content: buf,
      parseSummary: payouts
        .map((p) => `${storedId(p)} · net AED ${p.net.toFixed(2)} · ${p.orderRefs.length} orders`)
        .join(" | "),
    });
  } catch (e) {
    // parsing already succeeded — archiving must not fail the upload
    console.error("uploaded_files archive failed:", (e as Error).message);
  }

  await markReconDirty("upload/payout");
  return NextResponse.json({
    saved,
    fileId,
    pinnedTo,
    payouts: payouts.map((p) => ({
      id: storedId(p),
      provider: p.provider,
      net: p.net,
      store: p.store ?? null,
      // Surfaced so the uploader can see when a report had to take a
      // disambiguated id because another store already held its statement number.
      statementNo: p.statementNo ?? p.id,
      renamed: storedId(p) !== (p.statementNo ?? p.id),
      orderRefs: p.orderRefs,
      notes: p.notes,
    })),
  });
}
