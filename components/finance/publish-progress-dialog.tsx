"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

type Event =
  | { type: "start"; total: number }
  | { type: "progress"; index: number; invoiceId: string; invoiceNumber?: string;
      status: "ok" | "failed" | "skipped"; paymentId?: string; error?: string; reason?: string }
  | { type: "done"; ok: number; failed: number; skipped: number };

export function PublishProgressDialog({
  invoiceIds, accountId, date, referenceOverride, onClose, onDone,
}: {
  invoiceIds: string[];
  accountId: string;
  date: string;
  referenceOverride?: string;
  onClose: () => void;
  onDone: (ok: number, failed: number, skipped: number) => void;
}) {
  const [total, setTotal] = useState(invoiceIds.length);
  const [progress, setProgress] = useState(0);
  const [ok, setOk] = useState(0);
  const [failed, setFailed] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Array<{ invoiceId: string; error: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/invoices/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds, accountId, date, referenceOverride }),
      });
      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!cancelled) {
        const { done: rDone, value } = await reader.read();
        if (rDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const m = line.match(/^data: (.+)$/m);
          if (!m) continue;
          const evt = JSON.parse(m[1]) as Event;

          if (evt.type === "start") setTotal(evt.total);
          else if (evt.type === "progress") {
            setProgress(evt.index + 1);
            if (evt.status === "ok") setOk((v) => v + 1);
            else if (evt.status === "failed") {
              setFailed((v) => v + 1);
              setErrors((prev) => [...prev, { invoiceId: evt.invoiceId, error: evt.error ?? "Unknown" }]);
            } else if (evt.status === "skipped") setSkipped((v) => v + 1);
          } else if (evt.type === "done") {
            setDone(true);
            onDone(evt.ok, evt.failed, evt.skipped);
          }
        }
      }
    })().catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <Dialog open onOpenChange={(v) => !v && done && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Recording payments in Zoho</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Progress value={pct} className="h-2" />
          <div className="flex items-center justify-between text-[12.5px] text-[#6F5325]">
            <span>{progress} / {total}</span>
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