"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, BadgeCheck, BookCheck, Check, ChevronDown, Clock, Copy, Download,
  FileSpreadsheet, Flag, HelpCircle, Landmark, Loader2, Lock, Package, RotateCcw, Trash2, Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { GatewayProof } from "./gateway-proof";
import { ZohoPostDialog } from "./zoho-post-dialog";
import { gatewayColor, STATE_COLORS } from "./colors";
import { aed2, STATE_META, type ReconLine, type ReconTxn, type ZohoPostingState } from "./types";

type StripeProof =
  | { available: true; payoutId: string; net: number; refs: string[]; transactions: ReconTxn[] }
  | { available: false; reason: string };

const TONE_BG: Record<string, string> = {
  ok: "bg-[#F0F5EF] text-[#4B7A54]",
  bad: "bg-[#F9ECE7] text-[#A6472F]",
  warn: "bg-[#FBF2E6] text-[#B0742E]",
  info: "bg-[#E8F1F3] text-[#2E6B7A]",
  muted: "bg-[#F3EFE7] text-[#8A8175]",
};

const TONE_BORDER: Record<string, string> = {
  ok: "#4B7A54", bad: "#A6472F", warn: "#B0742E", info: "#2E6B7A", muted: "#D6CCBA",
};

const STATE_ICON = {
  SETTLED: Check, PAYOUT_VARIANCE: AlertTriangle, ORDERS_UNRESOLVED: HelpCircle, AWAITING_PAYOUT: Clock,
} as const;

/* ── Chain link ─────────────────────────────────────────────────────────── */

function ChainLink({ icon: Icon, label, sub, status }: {
  icon: React.ElementType; label: string; sub: string; status: "resolved" | "pending" | "broken";
}) {
  const c = {
    resolved: { border: "#B08343", bg: "#FBF3E6", fg: "#1F1B16", sub: "#6F5325" },
    pending: { border: "#EAE3D6", bg: "transparent", fg: "#8A8175", sub: "#8A8175" },
    broken: { border: "#A6472F", bg: "#F9ECE7", fg: "#A6472F", sub: "#A6472F" },
  }[status];

  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5"
      style={{ borderColor: c.border, background: c.bg }}
    >
      <Icon size={14} style={{ color: c.fg }} className="flex-shrink-0" />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="whitespace-nowrap text-[13px] font-semibold" style={{ color: c.fg }}>{label}</span>
        <span className="max-w-[140px] truncate text-[10.5px]" style={{ color: c.sub }}>{sub}</span>
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, tone = "default", disabled, title }: {
  icon: React.ElementType; label: string; onClick?: () => void;
  tone?: "default" | "primary" | "locked"; disabled?: boolean; title?: string;
}) {
  const cls =
    tone === "primary"
      ? "border-[#B08343] bg-[#B08343] text-white hover:bg-[#9a723a]"
      : tone === "locked"
        ? "border-dashed border-[#D6CCBA] bg-[#F3EFE7] text-[#8A8175] cursor-not-allowed"
        : "border-[#D6CCBA] bg-white text-[#1F1B16] hover:border-[#B08343] hover:text-[#6F5325]";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors disabled:opacity-60 ${cls}`}
    >
      <Icon size={14} /> {label}
    </button>
  );
}

/* ── Row ────────────────────────────────────────────────────────────────── */

export function ReconRow({ r, isFounder, posting, onConfirm, refresh, uploadSlot }: {
  r: ReconLine;
  isFounder: boolean;
  posting: ZohoPostingState | undefined;
  onConfirm: (id: string) => void;
  refresh: () => void;
  uploadSlot: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [showZoho, setShowZoho] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [flagged, setFlagged] = useState(r.reviewFlag);
  const [deleting, setDeleting] = useState(false);

  const meta = STATE_META[r.state];
  const Icon = STATE_ICON[r.state];
  const payoutOk = !!r.payout && Math.abs(r.variance) <= 1;
  const ordersOk = payoutOk && r.unresolvedRefs.length === 0 && r.resolvedOrders.length > 0;

  const ageDays = r.date ? Math.floor((Date.now() - new Date(r.date).getTime()) / 86_400_000) : null;
  const overdue = !r.payout && ageDays !== null && ageDays > 7;

  const isStripe = r.provider === "Stripe" && !!r.payout && r.payout.id.startsWith("STRIPE-");
  const [proof, setProof] = useState<StripeProof | null>(null);
  useEffect(() => {
    if (!open || !isStripe || proof || !r.payout) return;
    fetch(`/api/payouts/${encodeURIComponent(r.payout.id)}/stripe-proof`)
      .then((x) => x.json())
      .then((d: StripeProof) => setProof(d))
      .catch(() => setProof({ available: false, reason: "Could not reach Stripe" }));
  }, [open, isStripe, proof, r.payout]);

  const canPost = r.state === "SETTLED" && !!r.confirmedBy && !!r.payout;

  const toggleFlag = async () => {
    setFlagging(true);
    const next = !flagged;
    try {
      const res = await fetch("/api/reconcile/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId: r.id, flagged: next, note: next ? "Flagged for review" : "" }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Flag failed");
      setFlagged(next);
      toast.success(next ? "Flagged for review" : "Flag cleared");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFlagging(false);
    }
  };

  const deletePayout = async () => {
    if (!r.payout) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/payouts/${encodeURIComponent(r.payout.id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Delete failed");
      toast.success(`Payout ${r.payout.id} deleted — credit reverted to Awaiting payout`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const copyRef = () => {
    navigator.clipboard.writeText(r.reference || r.id);
    toast.success("Reference copied");
  };

  return (
    <div
      className="overflow-hidden rounded-xl border border-[#EAE3D6] bg-white shadow-sm transition-shadow hover:shadow-md"
      style={{ borderLeft: `3px solid ${flagged ? "#B08343" : TONE_BORDER[meta.tone]}` }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <ChainLink icon={Landmark} label={aed2(r.bankAmount)} sub={`Bank · ${r.reference || r.id.slice(0, 8)}`} status="resolved" />
          <ArrowRight size={13} style={{ color: payoutOk ? "#B08343" : "#D6CCBA" }} className="flex-shrink-0" />
          <ChainLink
            icon={FileSpreadsheet}
            label={r.payout ? aed2(r.payout.net) : "No file"}
            sub={r.payout ? r.payout.id : "not uploaded"}
            status={r.payout ? (payoutOk ? "resolved" : "broken") : "pending"}
          />
          <ArrowRight size={13} style={{ color: ordersOk ? "#B08343" : "#D6CCBA" }} className="flex-shrink-0" />
          <ChainLink
            icon={Package}
            label={ordersOk ? `${r.resolvedOrders.length} orders` : r.unresolvedRefs.length ? `${r.unresolvedRefs.length} missing` : "—"}
            sub={r.unresolvedRefs.length ? `#${r.unresolvedRefs.join(", ")} not found` : ordersOk ? `#${r.resolvedOrders.join(", ")}` : "awaiting payout"}
            status={ordersOk ? "resolved" : r.unresolvedRefs.length ? "broken" : "pending"}
          />
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1F1B16]">
            <i className="h-2.5 w-2.5 rounded-full" style={{ background: gatewayColor(r.provider) }} />
            {r.provider}
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${TONE_BG[meta.tone]}`}>
            <Icon size={12} />{r.confirmedBy ? "Confirmed" : meta.label}
          </span>
          {posting && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FBF3E6] px-2.5 py-1 text-[12px] font-medium text-[#6F5325]">
              <BookCheck size={12} />{posting.status === "partial" ? "Zoho partial" : "In Zoho"}
            </span>
          )}
          {flagged && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FBF3E6] px-2.5 py-1 text-[12px] font-medium text-[#6F5325]">
              <Flag size={12} />Flagged
            </span>
          )}
          {overdue && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F9ECE7] px-2.5 py-1 text-[12px] font-medium text-[#A6472F]">
              <AlertTriangle size={12} />{ageDays}d overdue
            </span>
          )}
          {r.refundedOrders.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F3EFE7] px-2.5 py-1 text-[12px] font-medium text-[#8A8175]">
              <RotateCcw size={12} />{r.refundedOrders.length} refund{r.refundedOrders.length > 1 ? "s" : ""}
            </span>
          )}
          <ChevronDown size={16} className="text-[#8A8175] transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }} />
        </div>
      </button>

      {open && (
        <div className="border-t border-[#EAE3D6] px-4 pb-4 pt-3">
          <p className="mb-3 font-mono text-[12px] leading-relaxed text-[#8A8175]">{r.narration}</p>

          <div className="mb-3.5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Date", r.date?.slice(0, 10) ?? "—"],
              ["Bank credit", aed2(r.bankAmount)],
              ["Payout net", r.payout ? aed2(r.payout.net) : "—"],
              ["Variance", aed2(r.variance)],
            ].map(([k, v], i) => (
              <div key={k}>
                <div className="text-[11px] text-[#8A8175]">{k}</div>
                <div
                  className="text-[14px] font-semibold tabular-nums"
                  style={{ color: i === 3 && Math.abs(r.variance) > 1 ? "#A6472F" : "#1F1B16" }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>

          {flagged && r.reviewNote && (
            <div className="mb-3.5 rounded-lg bg-[#FBF3E6] px-3.5 py-2.5 text-[13px] text-[#6F5325]">
              <b>Flagged for review:</b> {r.reviewNote}
            </div>
          )}

          {r.state === "SETTLED" && r.payout && (
            <div className="mb-3.5 rounded-lg bg-[#F0F5EF] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#4B7A54]">
              The {r.provider} payout ({r.payout.id}) net matches the bank credit exactly, and all{" "}
              {r.resolvedOrders.length} order{r.resolvedOrders.length > 1 ? "s are" : " is"} accounted for.
              {r.confirmedBy ? " Confirmed by the founder." : " Ready for founder confirmation."}
            </div>
          )}
          {r.state === "PAYOUT_VARIANCE" && r.payout && (
            <div className="mb-3.5 rounded-lg bg-[#F9ECE7] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#A6472F]">
              Bank credited <b>{aed2(r.bankAmount)}</b> but the {r.provider} payout says <b>{aed2(r.payout.net)}</b> — a{" "}
              {r.variance > 0 ? "surplus" : "shortfall"} of <b>{aed2(Math.abs(r.variance))}</b>. Likely cause:{" "}
              {r.payout.fxSource === "estimate"
                ? "the FX estimate used to convert this payout drifted from the bank's actual wire rate"
                : r.refundedOrders.length > 0
                  ? `${r.refundedOrders.length} refund${r.refundedOrders.length > 1 ? "s" : ""} may not net out the way expected`
                  : "a bank fee, rounding, or a partial settlement not reflected in the payout file"}.
            </div>
          )}
          {r.state === "ORDERS_UNRESOLVED" && (
            <div className="mb-3.5 rounded-lg bg-[#F9ECE7] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#A6472F]">
              {r.unresolvedRefs.length > 0 ? (
                <>The payout net matches the bank, but order <b>#{r.unresolvedRefs.join(", #")}</b>{" "}
                  {r.unresolvedRefs.length > 1 ? "aren't" : "isn't"} in the synced orders. Run a sync — this credit
                  can&apos;t be called Settled until every order it pays for is accounted for.</>
              ) : (
                <>The payout net matches the bank, but it carries no chargeable order references — nothing to settle yet.</>
              )}
            </div>
          )}
          {r.state === "AWAITING_PAYOUT" && (
            <div className="mb-3.5 rounded-lg bg-[#E8F1F3] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#2E6B7A]">
              Bank credit confirmed as {r.provider}
              {r.reference ? <> (ref <b>{r.reference}</b>)</> : null}. Upload the {r.provider} payout file that
              explains it — the reference number here should match the file.
              {overdue && <> This credit is <b>{ageDays} days old</b>, so the file is overdue.</>}
            </div>
          )}

          {isStripe && proof?.available && proof.transactions.length > 0 && (
            <GatewayProof
              r={r}
              live={{ transactions: proof.transactions, net: proof.net, sourceLabel: `live from Stripe · payout ${proof.payoutId}` }}
            />
          )}
          {isStripe && !proof && (
            <div className="mb-3.5 flex items-center gap-2 text-[12.5px] text-[#8A8175]">
              <Loader2 size={13} className="animate-spin" /> Pulling live Stripe transactions…
            </div>
          )}
          {isStripe && proof && !proof.available && (
            <div className="mb-3.5 rounded-lg bg-[#F3EFE7] px-3.5 py-2.5 text-[13px] text-[#8A8175]">
              Couldn&apos;t load live Stripe proof: {proof.reason}
            </div>
          )}
          {!isStripe && r.transactions.length > 0 && r.payout && <GatewayProof r={r} />}

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-2">
            {r.state === "SETTLED" && !r.confirmedBy && (
              isFounder ? (
                <ActionButton icon={BadgeCheck} label="Confirm settlement" tone="primary" onClick={() => onConfirm(r.id)} />
              ) : (
                <ActionButton icon={Lock} label="Founder confirms settlement" tone="locked" disabled />
              )
            )}
            {r.confirmedBy && (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#4B7A54]">
                <Check size={15} /> Confirmed by founder
              </span>
            )}

            {posting ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCBA] bg-[#FBF3E6] px-3 py-2 text-[12.5px] font-medium text-[#6F5325]"
                title={`Posted ${posting.postedAt?.slice(0, 10)} · ref ${posting.reference}`}
              >
                <BookCheck size={14} />
                {posting.status === "partial" ? "Zoho: one leg missing" : "Recorded in Zoho"}
              </span>
            ) : canPost ? (
              <ActionButton icon={BookCheck} label="Preview & post to Zoho" onClick={() => setShowZoho(true)} />
            ) : r.state === "SETTLED" ? (
              <ActionButton
                icon={BookCheck}
                label="Post to Zoho"
                tone="locked"
                disabled
                title="A person must confirm this settlement before it can reach the books"
              />
            ) : null}

            {r.payout?.source && (
              <a
                href={`/api/files/by-name?filename=${encodeURIComponent(r.payout.source)}&provider=${encodeURIComponent(r.provider)}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCBA] bg-white px-3 py-2 text-[12.5px] font-medium text-[#1F1B16] transition-colors hover:border-[#B08343] hover:text-[#6F5325]"
              >
                <Download size={14} /> Payout file
              </a>
            )}

            {r.payout && !r.confirmedBy && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    disabled={deleting}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCBA] bg-white px-3 py-2 text-[12.5px] font-medium text-[#A6472F] transition-colors hover:border-[#A6472F] hover:bg-[#F9ECE7] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete payout
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this payout?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes {r.payout.id} and its per-order breakdown. The bank credit reverts to
                      &quot;Awaiting payout&quot; so you can re-upload the correct file. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={deletePayout} className="bg-[#A6472F] hover:bg-[#8E3A25]">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            <ActionButton icon={Copy} label="Copy reference" onClick={copyRef} />
            <ActionButton
              icon={flagging ? Loader2 : Flag}
              label={flagged ? "Clear flag" : "Flag for review"}
              onClick={toggleFlag}
              disabled={flagging}
            />

            {r.state !== "SETTLED" && r.provider !== "Unclassified" && uploadSlot}
          </div>
        </div>
      )}

      {showZoho && (
        <ZohoPostDialog line={r} onClose={() => setShowZoho(false)} onPosted={refresh} />
      )}
    </div>
  );
}
