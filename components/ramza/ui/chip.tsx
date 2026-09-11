import type { ReactNode } from "react";

/* Text chip for integration names — no logos (brief). Optional status shown
   on hover / focus via the title attribute and a small dot. */
export function Chip({
  children,
  status,
  href,
}: {
  children: ReactNode;
  status?: "live" | "on-request";
  href?: string;
}) {
  const dot =
    status === "live"
      ? "var(--ledger)"
      : status === "on-request"
        ? "var(--residual)"
        : "transparent";
  const label =
    status === "live" ? "Live" : status === "on-request" ? "On request" : undefined;

  const inner = (
    <>
      {status && (
        <span
          aria-hidden
          className="size-1.5 rounded-full"
          style={{ background: dot }}
        />
      )}
      {children}
    </>
  );

  const cls =
    "inline-flex items-center gap-2 rounded-lg border r-hairline px-3 py-1.5 text-sm font-medium";

  if (href) {
    return (
      <a href={href} className={`${cls} transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]`} title={label}>
        {inner}
      </a>
    );
  }
  return (
    <span className={cls} title={label}>
      {inner}
    </span>
  );
}
