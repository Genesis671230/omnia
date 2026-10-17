/* RAMZA mark (2026-10-17): two brackets that close a square — the books
 * close. White + lilac on navy, or navy + indigo on white. Files in
 * public/ramza/brand/. */

export function RamzaMark({ size = 28, tone = "ink" }: { size?: number; tone?: "ink" | "light" }) {
  const bg = tone === "ink" ? "#0B1533" : "#FFFFFF";
  const top = tone === "ink" ? "#FFFFFF" : "#0B1533";
  const bottom = tone === "ink" ? "#B3A6FF" : "#4F35E8";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <rect width="64" height="64" rx="12" fill={bg} />
      <path d="M14 38V14h24" stroke={top} strokeWidth="7" fill="none" strokeLinecap="square" />
      <path d="M26 50h24V26" stroke={bottom} strokeWidth="7" fill="none" strokeLinecap="square" />
    </svg>
  );
}
