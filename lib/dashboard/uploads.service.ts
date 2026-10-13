// Upload log for the Admin tab: the latest payout per gateway (file or API
// sync) and every bank statement / payout file with the moment it was
// uploaded, so "is the money missing or is the file missing?" is one glance.
// Read-only.

import { currentTenant } from "@/lib/tenant";
import { selectAllPages, supabase } from "@/lib/supabase";

export type LatestPayout = {
  gateway: string;
  payoutId: string;
  store: string | null;
  netAed: number;
  orders: number | null;
  uploadedAt: string;
  /** File name, or "API" when the payout was synced rather than uploaded. */
  source: string;
  viaApi: boolean;
  /** Payouts of this gateway uploaded in the last 30 days. */
  last30: number;
};
export type UploadEvent = { kind: "bank" | "payout"; provider: string | null; filename: string; summary: string | null; uploadedAt: string };
export type Uploads = { latestPayouts: LatestPayout[]; latestBank: UploadEvent | null; events: UploadEvent[] };

const isFile = (s: string | null) => !!s && /\.(xlsx?|csv|pdf|txt)$/i.test(s.trim());

export async function buildUploads(): Promise<Uploads> {
  const tenant = currentTenant();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  type P = { id: string; gateway: string; store: string | null; net_amount: number; txn_count: number | null; uploaded_at: string | null; source: string | null };
  const [payouts, files] = await Promise.all([
    selectAllPages<P>((a, b) => supabase.from("payouts").select("id, gateway, store, net_amount, txn_count, uploaded_at, source")
      .eq("tenant_id", tenant).order("uploaded_at", { ascending: false }).range(a, b), "payouts"),
    supabase.from("uploaded_files").select("kind, provider, filename, parse_summary, uploaded_at")
      .eq("tenant_id", tenant).order("uploaded_at", { ascending: false }).limit(60),
  ]);
  if (files.error) throw new Error(`uploaded_files: ${files.error.message}`);

  const latest = new Map<string, LatestPayout>();
  for (const p of payouts) {
    if (!p.uploaded_at) continue;
    const g = p.gateway || "Unclassified";
    const hit = latest.get(g);
    if (hit) { if (p.uploaded_at >= since) hit.last30 += 1; continue; }
    latest.set(g, {
      gateway: g, payoutId: p.id, store: p.store, netAed: Number(p.net_amount) || 0, orders: p.txn_count,
      uploadedAt: p.uploaded_at, source: isFile(p.source) ? p.source!.trim() : "API", viaApi: !isFile(p.source),
      last30: p.uploaded_at >= since ? 1 : 0,
    });
  }
  const events: UploadEvent[] = (files.data ?? []).map((f) => ({
    kind: f.kind === "bank" ? "bank" : "payout", provider: f.provider, filename: f.filename, summary: f.parse_summary, uploadedAt: f.uploaded_at,
  }));
  return {
    latestPayouts: [...latest.values()].sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)),
    latestBank: events.find((e) => e.kind === "bank") ?? null,
    events,
  };
}
