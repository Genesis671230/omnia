// components/inventory/source-pill.tsx
const SOURCE_META: Record<string, { label: string; classes: string }> = {
    zoho:        { label: "Zoho",     classes: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
    shopify_uae: { label: "UAE",      classes: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
    shopify_ksa: { label: "KSA",      classes: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    shopify_wa:  { label: "WA",       classes: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
    woo:         { label: "WOO",      classes: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" },
    reconciler:  { label: "sync",     classes: "bg-neutral-500/15 text-neutral-300 border-neutral-500/30" },
    master:      { label: "master",   classes: "bg-neutral-500/15 text-neutral-300 border-neutral-500/30" },
  };
  
  export function SourcePill({ source }: { source: string }) {
    const meta = SOURCE_META[source] ?? { label: source, classes: "bg-neutral-800 text-neutral-400 border-neutral-700" };
    return (
      <span className={`inline-flex justify-center rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${meta.classes}`}>
        {meta.label}
      </span>
    );
  }