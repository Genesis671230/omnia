"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Month = { monthKey: string; spreadsheetId: string; label: string; createdAt: string };

async function fetchMonths(): Promise<Month[]> {
  const res = await fetch("/api/finance/payment-sheet-months");
  const json = await res.json();
  return json.months ?? [];
}

export function PaymentSheetMonthsPanel() {
  const queryClient = useQueryClient();
  const { data: months = [], isLoading } = useQuery({ queryKey: ["payment-sheet-months"], queryFn: fetchMonths });

  const [monthKey, setMonthKey] = useState("");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/finance/payment-sheet-months", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthKey, label, spreadsheetUrlOrId: url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add month");
    },
    onSuccess: () => {
      toast.success(`${label || monthKey} registered`);
      setMonthKey(""); setLabel(""); setUrl("");
      queryClient.invalidateQueries({ queryKey: ["payment-sheet-months"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: async (key: string) => {
      await fetch(`/api/finance/payment-sheet-months/${encodeURIComponent(key)}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["payment-sheet-months"] }),
  });

  return (
    <div className="rounded-2xl border border-[#EAE3D6] bg-white p-5">
      <h3 className="mb-1 text-[14.5px] font-semibold text-[#1F1B16]">Payments-sheet months</h3>
      <p className="mb-4 text-[12.5px] leading-relaxed text-[#8A8175]">
        Each month is its own Google Sheet — register the spreadsheet URL for every month you want the dashboard
        to include. Dashboard analytics (Gross/Net Sales, Fees, Exchanges, Refunds) aggregate across every month
        registered here.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-[11px] text-[#8A8175]">Month (YYYY-MM)</label>
          <Input value={monthKey} onChange={(e) => setMonthKey(e.target.value)} placeholder="2026-09" className="h-9 w-28" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-[#8A8175]">Label</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="September 2026" className="h-9 w-40" />
        </div>
        <div className="flex-1 min-w-[240px]">
          <label className="mb-1 block text-[11px] text-[#8A8175]">Spreadsheet URL or ID</label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className="h-9" />
        </div>
        <Button
          size="sm"
          disabled={addMutation.isPending || !monthKey || !url}
          onClick={() => addMutation.mutate()}
          className="h-9"
        >
          {addMutation.isPending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Plus size={14} className="mr-1.5" />}
          Add
        </Button>
      </div>

      {isLoading ? (
        <p className="text-[12.5px] text-[#8A8175]">Loading…</p>
      ) : months.length === 0 ? (
        <p className="text-[12.5px] text-[#8A8175]">No months registered yet — the dashboard has nothing to aggregate.</p>
      ) : (
        <div className="space-y-1.5">
          {months.map((m) => (
            <div key={m.monthKey} className="flex items-center justify-between rounded-lg border border-[#EAE3D6] px-3 py-2 text-[12.5px]">
              <span className="font-medium text-[#1F1B16]">{m.label}</span>
              <a
                href={`https://docs.google.com/spreadsheets/d/${m.spreadsheetId}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[#8A8175] hover:text-[#1F1B16]"
                title="Open in Google Sheets"
              >
                {m.monthKey} · {m.spreadsheetId.slice(0, 12)}… <ExternalLink size={12} />
              </a>
              <button
                onClick={() => removeMutation.mutate(m.monthKey)}
                disabled={removeMutation.isPending}
                className="text-[#A6472F] hover:text-[#8E3A25]"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
