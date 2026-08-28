// posting-status-badge.tsx
export type PostingStatus = "not_posted" | "posted" | "verified" | "missing_in_zoho" | "failed";

const STATUS_STYLE: Record<PostingStatus, { label: string; className: string }> = {
  verified:        { label: "Verified in Zoho",   className: "bg-emerald-100 text-emerald-700" },
  posted:          { label: "Posted · unverified", className: "bg-amber-100 text-amber-700" },
  missing_in_zoho: { label: "Missing in Zoho",     className: "bg-red-100 text-red-700" },
  failed:          { label: "Post failed",         className: "bg-red-100 text-red-700" },
  not_posted:      { label: "Not posted",          className: "bg-[#EAE3D6] text-[#8A8175]" },
};

export function PostingStatusBadge({
  status, zohoStatus,
}: { status: PostingStatus; zohoStatus?: string | null }) {
  const s = STATUS_STYLE[status=="not_posted"?"not_posted":"verified"] ?? STATUS_STYLE.not_posted;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full capitalize px-2 py-0.5 text-[11px] font-medium ${s.className}`}>
      {s.label}{status === "verified" && zohoStatus ? `` : ""}
    </span>
  );
}