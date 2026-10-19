/* RAMZA mark. Since 2026-10-19 this is the agent logo — a blue squircle whose
 * eyes blink and turn into an equals sign (components/ramza/brand/agent.tsx).
 * `tone` is the surface: "ink" = sits on white/light (the default, kept for
 * existing call sites), "light" = sits on the navy footer.
 *
 * The previous bracket mark (2026-10-17) is kept as RamzaBracketMark; its
 * files are still in public/ramza/brand/ramza-mark*.svg. */

import { RamzaAgentMark } from "@/components/ramza/brand/agent";

export function RamzaMark({ size = 28, tone = "ink", animated = true }: { size?: number; tone?: "ink" | "light"; animated?: boolean }) {
  return <RamzaAgentMark size={size} tone={tone === "ink" ? "light" : "dark"} animated={animated} />;
}

export function RamzaBracketMark({ size = 28, tone = "ink" }: { size?: number; tone?: "ink" | "light" }) {
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
