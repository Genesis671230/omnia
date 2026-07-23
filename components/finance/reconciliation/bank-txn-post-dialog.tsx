"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { aed2 } from "./types";

export type PostPreviewLine = {
  bankLineId: string;
  status: "posted" | "failed";
  error?: string;
  posting?: { transaction_type: string; amount: number; description: string; date: string };
};

export function BankTxnPostDialog({
  bankLineIds, onClose, onPosted,
}: {
  bankLineIds: string[];
  onClose: () => void;
  onPosted: () => void;
}) {
  const [preview, setPreview] = useState<PostPreviewLine[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/integrations/zoho/post-bank-lines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bankLineIds, dryRun: true }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setPreview(json.results);
      } catch (e) {
        toast.error((e as Error).message);
        onClose();
      } finally {
        setLoading(false);
      }
    })();
    // bankLineIds is a fixed snapshot for the lifetime of this dialog
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    setPosting(true);
    try {
      const res = await fetch("/api/integrations/zoho/post-bank-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineIds, actor: "founder" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const results = json.results as PostPreviewLine[];
      const failed = results.filter((r) => r.status === "failed").length;
      const ok = results.length - failed;
      toast.success(`${ok} posted to Zoho${failed ? `, ${failed} failed` : ""}`);
      onPosted();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#1F1B16]">Post {bankLineIds.length} to Zoho</h3>
          <button onClick={onClose}><X size={16} className="text-[#8A8175]" /></button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-[#8A8175]">
            <Loader2 size={16} className="animate-spin" /> Building preview…
          </div>
        ) : (
          <div className="space-y-2">
            {(preview ?? []).map((r) => (
              <div
                key={r.bankLineId}
                className={`rounded-lg border px-3 py-2 text-[12.5px] ${
                  r.status === "failed" ? "border-[#A6472F]/30 bg-[#F9ECE7]" : "border-[#EAE3D6] bg-[#FBF8F1]"
                }`}
              >
                {r.status === "failed" ? (
                  <span className="inline-flex items-center gap-1.5 text-[#A6472F]"><AlertTriangle size={13} /> {r.error}</span>
                ) : (
                  <span className="text-[#1F1B16]">
                    {r.posting?.transaction_type} · {aed2(r.posting?.amount ?? 0)} · {r.posting?.description}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-[#D6CCBA] bg-white px-4 py-2 text-[13px] text-[#1F1B16]">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={posting || loading || !preview?.some((r) => r.status === "posted")}
            className="inline-flex items-center gap-2 rounded-lg bg-[#B08343] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
          >
            {posting ? <Loader2 size={15} className="animate-spin" /> : null} Confirm & post
          </button>
        </div>
      </div>
    </div>
  );
}
