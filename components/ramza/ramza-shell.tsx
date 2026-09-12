import type { ReactNode } from "react";
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic, Fraunces } from "next/font/google";
import { Backdrop } from "./backdrop";
import "@/app/ramza/ramza.css";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
  adjustFontFallback: true,
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "600"],
  variable: "--font-plex-arabic",
  display: "swap",
});

/* Wraps every RAMZA-branded route (/ramza and /privacy). Sets the scoped
   token context and the IBM Plex fonts without touching the omnia app shell. */
export function RamzaShell({ children }: { children: ReactNode }) {
  return (
    <div
      data-ramza
      /* fraunces.variable was missing here. Every .r-h1 and .r-h2 declares
         font-family: var(--font-fraunces), Georgia, serif — and when the
         custom property is undefined the whole declaration is invalid at
         computed-value time, so it fell through to the inherited IBM Plex
         rather than to the Georgia fallback. The serif display face was
         loaded and never once rendered. */
      className={`${plex.variable} ${plexArabic.variable} ${fraunces.variable} relative min-h-screen`}
      style={{ color: "var(--ink)" }}
    >
      <Backdrop />
      <div className="relative z-[1]">{children}</div>
    </div>
  );
}
