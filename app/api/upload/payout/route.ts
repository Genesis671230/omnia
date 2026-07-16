import { NextResponse } from "next/server";
import type { Gateway } from "@/lib/gateways";
import { parsePayoutFile, type ParsedPayout } from "@/lib/parsers/payouts";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { FilesRepository } from "@/lib/repositories/files.repository";

export const maxDuration = 60;

// POST /api/upload/payout — multipart form with `file`; `provider` is an
// optional hint. Format is auto-detected: Telr .xls/.csv, Tamara statement
// .xlsx, Tabby settlement .xlsx, Stripe reconciliation/transfers .csv, or a
// generic provider CSV. The raw file is stored for later download.
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const providerRaw = String(form.get("provider") || "");
  const provider = (["Stripe", "Telr", "Checkout", "Tabby", "Tamara"].includes(providerRaw)
    ? providerRaw
    : undefined) as Gateway | undefined;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded (field name: file)" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let payouts: ParsedPayout[];
  try {
    payouts = parsePayoutFile(buf, file.name, provider);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }

  const saved = await PayoutsRepository.upsertPayouts(payouts);

  try {
    await FilesRepository.save({
      kind: "payout",
      provider: payouts[0]?.provider ?? provider,
      filename: file.name,
      mime: file.type || undefined,
      content: buf,
      parseSummary: payouts
        .map((p) => `${p.id} · net AED ${p.net.toFixed(2)} · ${p.orderRefs.length} orders`)
        .join(" | "),
    });
  } catch (e) {
    // parsing already succeeded — archiving must not fail the upload
    console.error("uploaded_files archive failed:", (e as Error).message);
  }

  return NextResponse.json({
    saved,
    payouts: payouts.map((p) => ({
      id: p.id,
      provider: p.provider,
      net: p.net,
      orderRefs: p.orderRefs,
      notes: p.notes,
    })),
  });
}
