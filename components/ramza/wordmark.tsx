import { RamzaAgentMark } from "./brand/agent";

/* RAMZA wordmark with رمز (ramz — "code, symbol, sign") as a small secondary
   mark, led by the agent logo. No backronym. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <RamzaAgentMark size={24} />
      <span className="text-lg font-semibold tracking-tight" style={{ color: "var(--ink)" }}>
        RAMZA
      </span>
      <span
        dir="rtl"
        lang="ar"
        aria-hidden
        className="text-sm"
        style={{ color: "var(--ink-60)", fontFamily: "var(--font-plex-arabic), serif" }}
      >
        رمز
      </span>
    </span>
  );
}
