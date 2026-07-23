"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowRight, BookCheck, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { aed2, type ReconLine } from "./types";

/* Preview-then-post for Zoho Books.
 *
 * IMPORTANT: this renders through a portal, OUTSIDE the .wrap element where
 * the workspace's design tokens (--gold, --ink, --cream…) are declared. Those
 * custom properties are NOT on :root, so a var() here resolves to nothing.
 * Every color below is therefore self-contained hex — the same constraint that
 * broke the invoice/ship modals.
 */

type Posting = {
  referenceNumber: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  date: string;
  description: string;
};

type DryRun = { dryRun: true; postings: Posting[]; input: Record<string, unknown> };

export function ZohoPostDialog({ line, onClose, onPosted }: {
  line: ReconLine;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [preview, setPreview] = useState<DryRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  // Preview immediately — opening this dialog IS the request to see the
  // postings; making the founder click twice to see them adds nothing. The
  // dry run never writes, so a double-invoke in StrictMode is harmless.
  useEffect(() => {
    let alive = true;
    fetch("/api/integrations/zoho/post-payout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankLineId: line.id, dryRun: true }),
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!alive) return;
        if (!ok) setError(j.error || "Preview failed");
        else setPreview(j);
      })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [line.id]);

  const post = async () => {
    setPosting(true);
    try {
      const res = await fetch("/api/integrations/zoho/post-payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId: line.id, actor: "founder" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(
        json.status === "partial"
          ? "Posted, but one leg did not land — check Zoho before treating this as done"
          : "Recorded in Zoho Books",
      );
      onPosted();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  const total = preview?.postings.reduce((s, p) => s + p.amount, 0) ?? 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(31,27,22,0.45)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-6 shadow-2xl"
        style={{ background: "#FFFFFF", color: "#1F1B16" }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-[22px]" style={{ color: "#1F1B16" }}>
              Record in Zoho Books
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: "#8A8175" }}>
              {line.provider} · {line.reference || line.id.slice(0, 8)} · {line.date?.slice(0, 10) ?? "no date"}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5" style={{ color: "#8A8175" }} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-[13px]" style={{ color: "#8A8175" }}>
            <Loader2 size={15} className="animate-spin" /> Building the postings…
          </div>
        ) : error ? (
          <div
            className="flex items-start gap-2 rounded-xl px-4 py-3 text-[13px] leading-relaxed"
            style={{ background: "#F9ECE7", color: "#A6472F" }}
          >
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <>
            <p className="mb-4 text-[13px] leading-relaxed" style={{ color: "#1F1B16" }}>
              This moves money out of the <b>{line.provider} clearing account</b> — where it has been sitting since
              the customer paid — into your bank account, with the gateway&apos;s fee split off. Nothing is written
              until you confirm.
            </p>

            <div className="space-y-2.5">
              {preview?.postings.map((p, i) => (
                <div
                  key={p.referenceNumber}
                  className="rounded-xl border p-3.5"
                  style={{ borderColor: "#EAE3D6", background: "#FBF8F1" }}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
                      style={{ background: i === 0 ? "#F0F5EF" : "#FBF2E6", color: i === 0 ? "#4B7A54" : "#B0742E" }}
                    >
                      {i === 0 ? "Net to bank" : "Gateway fee"}
                    </span>
                    <span className="font-mono text-[16px] font-semibold tabular-nums" style={{ color: "#1F1B16" }}>
                      {aed2(p.amount)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: "#8A8175" }}>
                    <span className="font-mono">{p.from_account_id}</span>
                    <ArrowRight size={12} />
                    <span className="font-mono">{p.to_account_id}</span>
                  </div>
                  <p className="mt-1.5 text-[12px]" style={{ color: "#8A8175" }}>
                    {p.description} · ref <span className="font-mono">{p.referenceNumber}</span>
                  </p>
                </div>
              ))}
            </div>

            <div
              className="mt-3 flex items-center justify-between rounded-xl px-3.5 py-2.5 text-[13px]"
              style={{ background: "#FBF3E6", color: "#6F5325" }}
            >
              <span>Total leaving the clearing account</span>
              <b className="font-mono tabular-nums">{aed2(total)}</b>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button
                onClick={post}
                disabled={posting}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-medium disabled:opacity-60"
                style={{ background: "#B08343", color: "#FFFFFF" }}
              >
                {posting ? <Loader2 size={15} className="animate-spin" /> : <BookCheck size={15} />}
                Post to Zoho Books
              </button>
              <button
                onClick={onClose}
                className="rounded-lg border px-4 py-2.5 text-[13px] font-medium"
                style={{ borderColor: "#D6CCBA", background: "#FFFFFF", color: "#1F1B16" }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
