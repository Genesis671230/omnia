import { Reveal } from "./reveal";

/* One line, set in a glass band. */
export function ContrastLine() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-10 sm:py-16">
      <Reveal>
        <div className="r-glass relative overflow-hidden rounded-[1.75rem] px-6 py-12 sm:px-12 sm:py-16">
          <div className="r-dotgrid absolute inset-0 -z-[1] opacity-60" />
          <p
            className="max-w-3xl text-[clamp(1.5rem,3.4vw,2.4rem)] font-semibold leading-[1.15] tracking-[-0.02em]"
            style={{ color: "var(--ink)" }}
          >
            Dashboards show you the gap.{" "}
            <span style={{ color: "var(--brand)" }}>RAMZA closes it.</span>
          </p>
        </div>
      </Reveal>
    </section>
  );
}
