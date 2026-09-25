"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Download, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { aed2, fmtOriginal, isDownloadableSource, type UnmatchedPayout } from "./types";

/* Payout files that were uploaded but that no bank credit claimed.
 *
 * A file whose total matched nothing used to vanish from the screen while
 * still sitting in the database, so it looked like the upload hadn't worked
 * (FT262517PC8K, before the refund-parsing fix). Every uploaded file now stays
 * visible here — downloadable, deletable — until someone deletes it. */

export function UnmatchedPayouts({ payouts, refresh }: { payouts: UnmatchedPayout[]; refresh: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  if (payouts.length === 0) return null

  const remove = async (p: UnmatchedPayout) => {
    setDeleting(p.id);
    try {
      const res = await fetch(`/api/payouts/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Delete failed");
      toast.success(`Deleted ${p.id}`);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-[#EBD3C9] bg-[#FDF6F3] px-3.5 py-2.5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left text-[13px] font-medium text-[#1F1B16]">
        <AlertTriangle size={14} className="text-[#A6472F]" />
        {payouts.length} uploaded payout file{payouts.length === 1 ? "" : "s"} not matched to a bank credit
        <span className="font-normal text-[#8A8175]">— kept until you delete {payouts.length === 1 ? "it" : "them"}</span>
        <ChevronDown size={14} className={`ml-auto text-[#8A8175] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <p className="mt-1 text-[12px] leading-relaxed text-[#6F5325]">
            Its net doesn&apos;t match any {payouts.length === 1 ? "credit" : "credits"} within tolerance, or the bank statement for it isn&apos;t
            uploaded yet. To attach one to a specific credit, open that credit and upload the file there — it then shows on that credit
            even if the totals differ.
          </p>
          <ul className="mt-2 divide-y divide-[#EBD3C9]">
            {payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-[12.5px]">
                <span className="font-medium text-[#1F1B16]">{p.provider}</span>
                <span className="font-mono text-[#6F5325]">{p.id}</span>
                <span className="tabular-nums text-[#1F1B16]">
                  net {aed2(p.net)}
                  {p.currency && p.netOriginal != null && <span className="text-[#8A8175]"> ({fmtOriginal(p.netOriginal, p.currency)})</span>}
                </span>
                <span className="text-[#8A8175]">{p.orders} order{p.orders === 1 ? "" : "s"}</span>
                {p.uploadedAt && (
                  <span className="text-[#8A8175]">
                    uploaded {new Date(p.uploadedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1.5">
                  {/* No link for API-synced payouts (source="stripe-api"):
                      there is no document, and the link 404'd. */}
                  {isDownloadableSource(p.source) && (
                    <a
                      href={`/api/files/by-name?filename=${encodeURIComponent(p.source!)}&provider=${encodeURIComponent(p.provider)}`}
                      className="inline-flex items-center gap-1 rounded-md border border-[#D6CCBA] bg-white px-2 py-1 text-[11.5px] text-[#1F1B16] hover:border-[#B08343]"
                      title={p.source!}
                    >
                      <Download size={12} /> File
                    </a>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        disabled={deleting === p.id}
                        className="inline-flex items-center gap-1 rounded-md border border-[#D6CCBA] bg-white px-2 py-1 text-[11.5px] text-[#A6472F] hover:border-[#A6472F] disabled:opacity-50"
                      >
                        {deleting === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {p.id}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Removes this payout and its per-order breakdown. The original file stays in Documents. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(p)} className="bg-[#A6472F] hover:bg-[#8E3A25]">Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
