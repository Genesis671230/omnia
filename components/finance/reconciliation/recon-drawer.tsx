"use client";

/* Right-side slide-over with a credit's bank → payout → orders breakdown and
 * its actions. Portalled to <body> with plain hex colors (not the shared Sheet):
 * ReconDetail opens its own dialogs (Zoho posting, record payments), and a
 * Radix modal underneath would block pointer events on them. The table stays
 * mounted behind it, so its scroll position is untouched on close. */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { gatewayColor } from "./colors";
import { ReconDetail } from "./recon-detail";
import { MatchStatusBadge } from "./recon-status-badge";
import { aed2, type ReconLine, type ZohoPostingState } from "./types";

export function ReconDrawer({ line, isFounder, posting, onConfirm, refresh, uploadSlot, onClose }: {
  line: ReconLine;
  isFounder: boolean;
  posting: ZohoPostingState | undefined;
  onConfirm: (id: string) => void;
  refresh: () => void;
  uploadSlot: React.ReactNode;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    // Esc closes the drawer only when no other dialog (Zoho posting, delete
    // confirm…) is open above it — each of those is its own fixed overlay.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelectorAll(".fixed.inset-0").length > 1) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(id); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9000]" data-recon-drawer role="dialog" aria-modal="false" aria-label={`${line.provider} credit ${line.reference}`}>
      <div
        onClick={onClose}
        className={`absolute inset-0 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
        style={{ background: "rgba(31,27,22,0.28)" }}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-[760px] flex-col shadow-[-12px_0_40px_rgba(31,27,22,0.18)] transition-transform duration-200 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}
        style={{ background: "#FFFFFF", color: "#1F1B16" }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#EAE3D6] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
              <i className="h-2.5 w-2.5 rounded-full" style={{ background: gatewayColor(line.provider) }} aria-hidden />
              {line.provider}
              <span className="font-mono text-[15px] tabular-nums">{aed2(line.bankAmount)}</span>
              <MatchStatusBadge line={line} />
            </div>
            <div className="mt-1 truncate font-mono text-[12px] text-[#8A8175]">
              Bank ref {line.reference || line.id.slice(0, 12)} · {line.date?.slice(0, 10) ?? "no date"}
              {line.payout ? ` · payout ${line.payout.id}` : ""}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[#8A8175] transition-colors hover:bg-[#F3EFE7] hover:text-[#1F1B16]">
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          <ReconDetail r={line} isFounder={isFounder} posting={posting} onConfirm={onConfirm} refresh={refresh} uploadSlot={uploadSlot} onClose={onClose} />
        </div>
      </aside>
    </div>,
    document.body,
  );
}
