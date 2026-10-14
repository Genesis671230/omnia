import { getZohoConnection, zohoOrgForProvider } from "@/lib/integrations/zoho-org";
import { ENV_CONNECTION_ID } from "@/lib/integrations/zoho-context";
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
  console.log("buf", buf);
  let payouts: ParsedPayout[];
  try {
    payouts = await parsePayoutFileAsync(buf, file.name, provider);
    // A Shopify Payments export doesn't say which store it's from; the order
    // numbers in it do. Optional `store` form field overrides.
    payouts = await assignShopifyStores(payouts, String(form.get("store") || "").toUpperCase() || null);
  } catch (e) {
    console.error("parsePayoutFileAsync error", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }

  // A colliding statement number is stored under a disambiguated id (Tabby
  // reuses one number across every store it pays that day), so everything
  // downstream must act on the id the row actually claimed, not the parser's.
  // Which Zoho organisation's books these payouts close. An explicit choice
  // wins ("env" = main); otherwise the provider's routing rule from Settings
  // (e.g. COD / OnTrack → House of Omnia). Validated before anything is saved.
  const zohoOrgField = String(form.get("zohoOrg") ?? "").trim();
  if (zohoOrgField && zohoOrgField !== ENV_CONNECTION_ID && !(await getZohoConnection(zohoOrgField))) {
    return NextResponse.json({ error: `Unknown Zoho organisation "${zohoOrgField}"` }, { status: 400 });
  }

  const resolvedIds = await PayoutsRepository.upsertPayoutsWithIds(payouts);
  const storedId = (p: ParsedPayout) => resolvedIds.get(p.id) ?? p.id;
  const saved = resolvedIds.size;

  const orgOf = new Map<string, string>();
  for (const p of payouts) {
    const org = zohoOrgField ? (zohoOrgField === ENV_CONNECTION_ID ? "" : zohoOrgField) : await zohoOrgForProvider(p.provider);
    if (zohoOrgField || org) orgOf.set(storedId(p), org);
  }
  // A payout that already booked settlements keeps its organisation: moving
  // it would let the same voucher be booked again in the other org's books.
  const kept: string[] = [];
  if (orgOf.size) {
    const { data: booked } = await supabase.from("settlement_records").select("payout_id").in("payout_id", [...orgOf.keys()]);
    const { data: current } = await supabase.from("payouts").select("id, zoho_connection_id").in("id", [...orgOf.keys()]);
    const was = new Map((current ?? []).map((r) => [r.id as string, (r.zoho_connection_id as string) ?? ""]));
    for (const { payout_id } of booked ?? []) {
      const id = payout_id as string;
      if (orgOf.has(id) && orgOf.get(id) !== was.get(id)) { kept.push(id); orgOf.set(id, was.get(id) ?? ""); }
    }
  }
  for (const org of new Set(orgOf.values())) {
    await PayoutsRepository.setZohoConnection([...orgOf].filter(([, o]) => o === org).map(([id]) => id), org);
  }

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
    ...(kept.length ? { zohoOrgKept: kept, zohoOrgNote: `${kept.length} payout(s) already have booked settlements, so they stay in their current Zoho organisation.` } : {}),
    fileId,
    pinnedTo,
    payouts: payouts.map((p) => ({
      id: storedId(p),
      provider: p.provider,
      net: p.net,
      store: p.store ?? null,
      zohoOrg: orgOf.get(storedId(p)) ?? null,
      // Surfaced so the uploader can see when a report had to take a
      // disambiguated id because another store already held its statement number.
      statementNo: p.statementNo ?? p.id,
      renamed: storedId(p) !== (p.statementNo ?? p.id),
      orderRefs: p.orderRefs,
      notes: p.notes,
    })),
  });
}
