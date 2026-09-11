import type { ReactNode } from "react";

/* Vertical rhythm + max width. The page backdrop carries separation now, so
   sections lean on whitespace and an optional tinted field rather than rules. */
export function Section({
  id,
  children,
  field = false,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  field?: boolean;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`relative ${id ? "scroll-mt-24" : ""} ${className}`}
    >
      {field && (
        <div
          aria-hidden
          className="r-field-bg r-dotgrid absolute inset-x-2 inset-y-6 -z-[1] mx-auto max-w-[78rem] rounded-[2rem] opacity-90 sm:inset-x-6 sm:inset-y-10"
        />
      )}
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-24">{children}</div>
    </section>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="r-h2 r-measure">{children}</h2>;
}
