"use client";

/* Modal wrapper around ReconDetail, opened by clicking a row in
 * recon-table.tsx. Uses createPortal + a self-contained fixed overlay (not
 * the shared <Dialog>) for the same reason zoho-post-dialog.tsx does — a
 * position:fixed child of the reconciliation surface gets trapped by an
 * ancestor transform/contain context otherwise (see the "modal portal fix"
 * this codebase has hit before). */

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { gatewayColor } from "./colors";
import { ReconDetail } from "./recon-detail";
import { STATE_META, type ReconLine, type ZohoPostingState } from "./types";

export function ReconDetailDialog({ line, isFounder, posting, onConfirm, refresh, uploadSlot, onClose }: {
  line: ReconLine;
  isFounder: boolean;
  posting: ZohoPostingState | undefined;
  onConfirm: (id: string) => void;
  refresh: () => void;
  uploadSlot: React.ReactNode;
  onClose: () => void;
}) {
  const meta = STATE_META[line.state];

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: "rgba(31,27,22,0.45)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-auto w-full max-w-3xl rounded-2xl p-6 shadow-2xl"
        style={{ background: "#FFFFFF", color: "#1F1B16" }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <i className="h-2.5 w-2.5 rounded-full" style={{ background: gatewayColor(line.provider) }} />
              {line.provider}
              <span className="text-[13px] font-normal text-[#8A8175]">
                · {line.confirmedBy ? "Confirmed" : meta.label}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[12px] text-[#8A8175]">
              Bank ref {line.reference || line.id.slice(0, 12)} · {line.date?.slice(0, 10) ?? "no date"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-[#EAE3D6] p-1.5 text-[#8A8175] transition-colors hover:border-[#D6CCBA] hover:text-[#1F1B16]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <ReconDetail
          r={line}
          isFounder={isFounder}
          posting={posting}
          onConfirm={onConfirm}
          refresh={refresh}
          uploadSlot={uploadSlot}
          onClose={onClose}
        />
      </div>
    </div>,
    document.body,
  );
}
