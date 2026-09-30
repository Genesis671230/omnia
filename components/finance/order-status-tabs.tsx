"use client";

/* The Orders list's status tabs — Sales / Cancelled / Void / Refunded &
 * returned / Failed / Not in Zoho — and, on "Not in Zoho", the list the team
 * needs to create sales orders for: copy it as text or download a CSV. */

import { motion } from "framer-motion";
import { ClipboardCopy, Download } from "lucide-react";
import { toast } from "sonner";

export type OrderStatusTab = "all" | "cancelled" | "voided" | "refunded" | "failed" | "not_in_zoho";
export type MissingInZoho = { order_number: string; order_date: string | null; store_id: string; gross_aed: number | null; customer_name: string }[];

const TABS: { id: OrderStatusTab; label: string; hint: string }[] = [
  { id: "all", label: "All orders", hint: "Every order in the window" },
  { id: "cancelled", label: "Cancelled", hint: "Cancelled before payment was kept" },
  { id: "voided", label: "Void", hint: "Payment authorisation voided" },
  { id: "refunded", label: "Refunded & returned", hint: "Refunded in full or in part — returns land here" },
  { id: "failed", label: "Failed", hint: "Payment failed" },
  { id: "not_in_zoho", label: "Not in Zoho", hint: "Sales with no Zoho sales order yet — send this list to the team" },
];

export function OrderStatusTabs({ value, onChange, counts }: {
  value: OrderStatusTab;
  onChange: (v: OrderStatusTab) => void;
  counts: Partial<Record<OrderStatusTab, number>>;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[#EBE5D6]" role="tablist" aria-label="Order status">
      {TABS.map((t) => {
        const on = value === t.id;
        const n = counts[t.id];
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            title={t.hint}
            onClick={() => onChange(t.id)}
            className={`relative -mb-px inline-flex items-center gap-1.5 pb-2.5 text-[13px] transition-colors ${on ? "text-[#1C1913]" : "text-[#8C8574] hover:text-[#1C1913]"}`}
          >
            {t.label}
            {n != null && (
              <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${t.id === "not_in_zoho" && n > 0 ? "bg-[#F7E7E1] text-[#C15540]" : "bg-[#F0ECE1] text-[#7C7565]"}`}>{n.toLocaleString()}</span>
            )}
            {on && <motion.span layoutId="order-status-underline" className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[#1C1913]" />}
          </button>
        );
      })}
    </div>
  );
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/** On "Not in Zoho": what the team has to create, ready to send. */
export function MissingInZohoBar({ rows, orgs, loading, error }: {
  rows: MissingInZoho;
  orgs: { label: string; count: number }[];
  loading: boolean;
  error: string;
}) {
  const text = () =>
    `Please create Zoho sales orders for these ${rows.length} order(s):\n` +
    rows.map((r) => `${r.order_number} · ${day(r.order_date)} · ${r.store_id} · AED ${Number(r.gross_aed ?? 0).toFixed(2)}`).join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      toast.success(`Copied ${rows.length} order numbers`);
    } catch {
      toast.error("Couldn't copy — use Download instead");
    }
  };
  const download = () => {
    const csv = ["order_number,order_date,store,amount_aed,customer",
      ...rows.map((r) => [r.order_number, day(r.order_date), r.store_id, Number(r.gross_aed ?? 0).toFixed(2), `"${(r.customer_name ?? "").replace(/"/g, '""')}"`].join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `orders-missing-zoho-sales-order-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[#E6C1B4] bg-[#FBF3EF] px-4 py-3 text-[13px] text-[#5C5647]">
      {loading ? (
        <span>Checking Zoho sales orders in every organisation… (first check takes ~20 s, then it&apos;s cached)</span>
      ) : error ? (
        <span className="text-[#C15540]">{error}</span>
      ) : (
        <>
          <span>
            <b className="font-medium text-[#1C1913]">{rows.length}</b> sale{rows.length === 1 ? "" : "s"} with no Zoho sales order
            <span className="text-[#8C8574]"> · checked {orgs.map((o) => `${o.label} (${o.count.toLocaleString()} sales orders)`).join(", ")}</span>
          </span>
          {rows.length > 0 && (
            <span className="ml-auto flex gap-2">
              <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-full bg-[#1C1913] px-3.5 py-1.5 text-[12.5px] font-medium text-white"><ClipboardCopy size={13} /> Copy list for the team</button>
              <button onClick={download} className="inline-flex items-center gap-1.5 rounded-full border border-[#DED6C2] bg-white px-3.5 py-1.5 text-[12.5px]"><Download size={13} /> CSV</button>
            </span>
          )}
        </>
      )}
    </div>
  );
}
