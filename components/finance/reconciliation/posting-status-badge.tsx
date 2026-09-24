// posting-status-badge.tsx
import type { LineZohoDetail } from "@/lib/reconciliation/bank-line-zoho-status";
import { aed2 } from "./types";

export type PostingStatus =
  | "not_posted" | "posted" | "verified" | "missing_in_zoho" | "failed"
  | "uncategorized" | "amount_differs" | "not_in_zoho";

const STATUS_STYLE: Record<PostingStatus, { label: string; className: string }> = {
  verified:        { label: "In Zoho ✓",             className: "bg-emerald-100 text-emerald-700" },
  posted:          { label: "Posted · refresh to verify", className: "bg-amber-100 text-amber-700" },
  uncategorized:   { label: "In Zoho feed · not booked", className: "bg-amber-100 text-amber-700" },
  amount_differs:  { label: "Ref in Zoho · amount differs", className: "bg-orange-100 text-orange-700" },
  missing_in_zoho: { label: "Posted · gone from Zoho", className: "bg-red-100 text-red-700" },
  failed:          { label: "Post failed",           className: "bg-red-100 text-red-700" },
  not_in_zoho:     { label: "Not in Zoho",           className: "bg-[#EAE3D6] text-[#8A8175]" },
  not_posted:      { label: "Not checked",           className: "bg-[#EAE3D6] text-[#8A8175]" },
};

const TYPE_LABEL: Record<string, string> = {
  transfer_fund: "Transfer", expense: "Expense", deposit: "Deposit", owner_drawings: "Owner drawings",
  owner_contribution: "Owner contribution", other_income: "Other income", interest_income: "Interest income",
};

export function PostingStatusBadge({
  status, zoho, error,
}: { status: PostingStatus; zohoStatus?: string | null; zoho?: LineZohoDetail | null; error?: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.not_posted;
  const title = zoho
    ? [`Zoho ref: ${zoho.reference ?? "—"}`, `Amount: ${zoho.amount == null ? "—" : aed2(zoho.amount)}`,
       zoho.type ? `Type: ${TYPE_LABEL[zoho.type] ?? zoho.type}` : "", zoho.account ? `Account: ${zoho.account}` : "",
       zoho.date ? `Zoho date: ${zoho.date}` : ""].filter(Boolean).join("\n")
    : error || undefined;
  return (
    <div className="min-w-0" title={title}>
      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${s.className}`}>
        {s.label}
      </span>
      {zoho && (status === "verified" || status === "amount_differs" || status === "uncategorized") && (
        <div className="mt-0.5 max-w-[220px] truncate text-[11px] text-[#8A8175]">
          {zoho.amount != null && aed2(zoho.amount)}
          {zoho.account ? ` · ${zoho.account}` : zoho.type ? ` · ${TYPE_LABEL[zoho.type] ?? zoho.type}` : ""}
          {zoho.matchKind === "combined" && " · booked together with sibling lines"}
          {zoho.matchKind === "amount_date" && ` · matched on amount + date, Zoho ref ${zoho.reference ?? "—"}`}
        </div>
      )}
    </div>
  );
}
