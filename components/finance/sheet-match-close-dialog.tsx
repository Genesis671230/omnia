"use client";

/* Closes a set of Zoho invoices matched from the payments sheet. Unlike the
   manual workbench flow (one shared date + payment mode + account for the
   whole selection), sheet-matched invoices span several distinct payment
   dates AND different Zoho clearing accounts (Tabby KSA vs Tabby UAE vs
   Telr Gateway, etc — see lib/finance/gateway-account-map.ts). Each group
   below carries its own resolved accountId; /api/invoices/publish only
   takes one date + mode + account per call, so this fires that same
   streaming endpoint once per group, sequentially — no changes to the
   money-writing endpoint itself. */

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export type CloseGroup = {
  key: string;
  date: string;
  paymentMode: string;
  accountId: string;
  accountName: string;
  invoiceIds: string[];
};

type StreamEvent =
  | { type: "start"; total: number }
  | { type: "progress"; index: number; invoiceId: string; status: "ok" | "failed" | "skipped"; error?: string }
  | { type: "done"; ok: number; failed: number; skipped: number };

async function runGroup(
  group: CloseGroup,
  onEvent: (evt: StreamEvent) => void,
): Promise<void> {
  const res = await fetch("/api/invoices/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invoiceIds: group.invoiceIds, accountId: group.accountId, date: group.date, paymentMode: group.paymentMode }),
  });
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const m = line.match(/^data: (.+)$/m);
      if (!m) continue;
      onEvent(JSON.parse(m[1]) as StreamEvent);
    }
  }
}

export function SheetMatchCloseDialog({
  groups, onClose, onDone,
}: {
  groups: CloseGroup[];
  onClose: () => void;
  onDone: (ok: number, failed: number, skipped: number) => void;
}) {
  const totalInvoices = groups.reduce((s, g) => s + g.invoiceIds.length, 0);
  const [groupIndex, setGroupIndex] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [ok, setOk] = useState(0);
  const [failed, setFailed] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Array<{ invoiceId: string; error: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let okTotal = 0, failedTotal = 0, skippedTotal = 0;
      for (let g = 0; g < groups.length; g++) {
        if (cancelled) return;
        setGroupIndex(g);
        await runGroup(groups[g], (evt) => {
          if (cancelled) return;
          if (evt.type === "progress") {
            setProcessed((v) => v + 1);
            if (evt.status === "ok") { okTotal++; setOk((v) => v + 1); }
            else if (evt.status === "failed") {
              failedTotal++;
              setFailed((v) => v + 1);
              setErrors((prev) => [...prev, { invoiceId: evt.invoiceId, error: evt.error ?? "Unknown" }]);
            } else if (evt.status === "skipped") { skippedTotal++; setSkipped((v) => v + 1); }
          }
        });
      }
      if (!cancelled) {
        setDone(true);
        onDone(okTotal, failedTotal, skippedTotal);
      }
    })().catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = totalInvoices > 0 ? Math.round((processed / totalInvoices) * 100) : 0;

  return (
    <Dialog open onOpenChange={(v) => !v && done && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Recording payments in Zoho</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Progress value={pct} className="h-2" />
          {groups[groupIndex] && !done && (
            <div className="text-[11.5px] text-[#8A8175]">
              Posting to <span className="font-medium text-[#1F1B16]">{groups[groupIndex].accountName}</span> · {groups[groupIndex].paymentMode} · {groups[groupIndex].date}
            </div>
          )}
          <div className="flex items-center justify-between text-[12.5px] text-[#6F5325]">
            <span>
              {processed} / {totalInvoices}
              {groups.length > 1 && <span className="text-[#B5AC98]"> · batch {groupIndex + 1}/{groups.length}</span>}
            </span>
            <span className="flex items-center gap-3">
              {ok > 0 && (<span className="flex items-center gap-1 text-[#4B7A54]"><CheckCircle2 size={12} />{ok}</span>)}
              {skipped > 0 && (<span className="text-[#8A8175]">{skipped} skipped</span>)}
              {failed > 0 && (<span className="flex items-center gap-1 text-[#A6472F]"><AlertCircle size={12} />{failed}</span>)}
              {!done && <Loader2 size={12} className="animate-spin" />}
            </span>
          </div>

          {errors.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-auto rounded-lg bg-[#F9ECE7] p-2">
              {errors.map((e, i) => (
                <div key={i} className="font-mono text-[11px] text-[#A6472F]">
                  …{e.invoiceId.slice(-8)}: {e.error}
                </div>
              ))}
            </div>
          )}

          {done && (
            <Button onClick={onClose} className="w-full bg-[#6F5325] text-white hover:bg-[#5A4320]">
              Close
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
