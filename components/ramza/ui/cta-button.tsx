import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "outline";

/* Anchor-styled CTA. No trailing arrow (brief). */
export function CtaLink({
  href,
  variant = "primary",
  children,
  className = "",
  ...rest
}: { href: string; variant?: Variant; children: ReactNode; className?: string } & ComponentProps<"a">) {
  return (
    <a
      href={href}
      className={`r-btn ${variant === "primary" ? "r-btn-primary" : "r-btn-outline"} ${className}`}
      {...rest}
    >
      {children}
    </a>
  );
}

export function CtaButton({
  variant = "primary",
  children,
  className = "",
  ...rest
}: { variant?: Variant; children: ReactNode; className?: string } & ComponentProps<"button">) {
  return (
    <button
      className={`r-btn ${variant === "primary" ? "r-btn-primary" : "r-btn-outline"} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
