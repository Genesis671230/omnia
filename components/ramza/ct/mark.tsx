/* RAMZA mark: a rounded ink square with two ledger lines that overlap in the
 * middle — two records (payout, bank line) meeting. Replaces the old hexagon. */

export function RamzaMark({ size = 28, tone = "ink" }: { size?: number; tone?: "ink" | "light" }) {
  const bg = tone === "ink" ? "#14131C" : "#FFFFFF";
  const top = "#B3A6FF";
  const bottom = tone === "ink" ? "#FFFFFF" : "#4F35E8";
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden className="shrink-0">
      <rect width="28" height="28" rx="8" fill={bg} />
      <rect x="6" y="9.5" width="12" height="3.2" rx="1.6" fill={top} />
      <rect x="10" y="15.3" width="12" height="3.2" rx="1.6" fill={bottom} />
    </svg>
  );
}
