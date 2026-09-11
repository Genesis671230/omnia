import { PAIN } from "@/lib/ramza/copy";
import { Reveal } from "./reveal";

/* Three short statements. Glass cards, staggered in. */
export function PainStrip() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
      <div className="grid gap-4 md:grid-cols-3">
        {PAIN.map((line, i) => (
          <Reveal key={i} delay={i * 0.08}>
            <p
              className="r-glass h-full rounded-2xl p-6 text-[0.9375rem] leading-relaxed"
              style={{ color: "var(--ink)" }}
            >
              {line}
            </p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
