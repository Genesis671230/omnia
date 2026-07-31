// components/inventory/event-badge.tsx
type Props = { type: string; delta: number | null; qty: number | null };

// The one-line semantic: what did this event actually do to stock?
// Kept dense on purpose — this cell is 80px wide in the ticker.
export function EventBadge({ type, delta, qty }: Props) {
  if (type === "order_decrement") {
    return <Badge tone="red" text={`↓${Math.abs(delta ?? 0)}`} title="Order decrement" />;
  }
  if (type === "refund") {
    return <Badge tone="green" text={`↑${delta ?? 0}`} title="Refund" />;
  }
  if (type === "restock") {
    return <Badge tone="green" text={`+${delta ?? 0}`} title="Restock" />;
  }
  if (type === "manual_adjust") {
    const sign = (delta ?? 0) >= 0 ? "+" : "";
    return <Badge tone="amber" text={`${sign}${delta ?? 0}`} title="Manual adjust" />;
  }
  if (type === "reconcile_push") {
    return <Badge tone="blue" text={`=${qty ?? "?"}`} title="Pushed to store" />;
  }
  if (type === "reconcile_correction") {
    return <Badge tone="blue" text={`↔${qty ?? "?"}`} title="Auto-corrected" />;
  }
  if (type === "snapshot") {
    return <Badge tone="neutral" text={`${qty ?? "?"}`} title="Snapshot" />;
  }
  if (type === "webhook_reject") {
    return <Badge tone="red" text="rej" title="Webhook rejected" />;
  }
  return <Badge tone="neutral" text={type.slice(0, 6)} title={type} />;
}

const TONES = {
  red:     "bg-red-500/10 text-red-300",
  green:   "bg-emerald-500/10 text-emerald-300",
  amber:   "bg-amber-500/10 text-amber-300",
  blue:    "bg-sky-500/10 text-sky-300",
  neutral: "bg-neutral-500/10 text-neutral-400",
} as const;

function Badge({ tone, text, title }: { tone: keyof typeof TONES; text: string; title: string }) {
  return (
    <span title={title} className={`inline-flex justify-center rounded font-mono text-[11px] px-2 py-0.5 ${TONES[tone]}`}>
      {text}
    </span>
  );
}