"use client";

/* The hero ground.

   This replaces the stock clip that used to sit here (public/ramza/hero-bg.mp4
   is still on disk if it is ever wanted back). The clip read as a grey smudge
   behind the headline, cost about a megabyte, and said nothing about the
   product. This says the product: ledger paper at scale, amount columns, rows
   that resolve from open to matched, and five connector paths running order to
   books across the page.

   All of it is one inline SVG plus the existing dot grid and halos, so it is
   a few kilobytes, stays sharp at any density, follows the theme, and has
   nothing to load. */

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

const ROWS = 14;
const ROW_H = 34;

/* Deterministic pseudo-random so the field is identical on server and client
   and never triggers a hydration mismatch. */
function rand(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

export function HeroField() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  // Hero parallax is keyed to the page scroll from the top, not to the element
  // crossing the viewport, because the hero starts already in view.
  const { scrollY } = useScroll();
  const ledgerY = useTransform(scrollY, [0, 900], [0, 130]);
  const connectorY = useTransform(scrollY, [0, 900], [0, 62]);
  const dotsY = useTransform(scrollY, [0, 900], [0, 34]);
  const still = { y: 0 };

  const rows = Array.from({ length: ROWS }, (_, i) => {
    const y = 60 + i * ROW_H;
    const matched = rand(i + 3) > 0.32;
    const width = 90 + Math.round(rand(i + 11) * 150);
    return { y, matched, width, i };
  });

  return (
    <div ref={ref} aria-hidden className="absolute inset-0 overflow-hidden">
      {/* the ledger itself, anchored right so it never fights the headline */}
      <motion.svg
        style={reduce ? still : { y: ledgerY }}
        className="absolute inset-y-0 right-0 h-full w-[min(100%,1100px)]"
        viewBox="0 0 1100 560"
        preserveAspectRatio="xMaxYMid slice"
        fill="none"
      >
        <defs>
          {/* White reveals, black hides. The ledger belongs on the right, so
              the ramp runs dark-to-light left-to-right and the copy column
              keeps a clean ground. */}
          <linearGradient id="rf-fade" x1="0" x2="1">
            <stop offset="0" stopColor="#000" />
            <stop offset="0.30" stopColor="#000" />
            <stop offset="0.62" stopColor="#888" />
            <stop offset="1" stopColor="#fff" />
          </linearGradient>
          <mask id="rf-mask">
            <rect width="1100" height="560" fill="url(#rf-fade)" />
          </mask>
        </defs>

        <g mask="url(#rf-mask)">
          {/* amount columns */}
          {[620, 780, 900, 1010].map((x) => (
            <line
              key={x}
              x1={x}
              y1="18"
              x2={x}
              y2="542"
              stroke="var(--rule)"
              strokeWidth="1"
            />
          ))}

          {/* ruled rows, with an open/matched marker and a value bar */}
          {rows.map((r) => (
            <g key={r.i}>
              <line
                x1="20"
                y1={r.y}
                x2="1080"
                y2={r.y}
                stroke="var(--rule)"
                strokeWidth="1"
              />
              {/* Description bar, then the amount, then the status mark. All
                  of it sits right of x=680 so the reveal mask does not eat the
                  one part of the row that carries meaning. */}
              <rect
                x={700}
                y={r.y - 11}
                width={Math.min(r.width, 200)}
                height="4"
                rx="2"
                fill="var(--ink)"
                opacity="0.1"
              />
              <rect
                x={1010 - 48 - Math.round(rand(r.i + 5) * 34)}
                y={r.y - 12}
                width={48 + Math.round(rand(r.i + 5) * 34)}
                height="5"
                rx="2.5"
                /* Texture, not data. At 0.30/0.42 these bars sat at reading
                   contrast in the same green and amber the real UI uses for
                   matched and pending, so the eye tried to parse the backdrop
                   as a ledger, failed, and read the hero as a half-loaded
                   screen. Low enough now to suggest rows resolving without
                   competing with the product frame that carries the actual
                   numbers. */
                fill={r.matched ? "var(--ledger)" : "var(--residual)"}
                opacity={r.matched ? 0.1 : 0.13}
              />
              <circle
                cx="1050"
                cy={r.y - 9}
                r="3.6"
                fill={r.matched ? "var(--ledger)" : "none"}
                stroke={r.matched ? "none" : "var(--residual)"}
                strokeWidth="1.6"
                opacity="0.16"
              />
              {/* filler ticks in the middle columns */}
              {[800, 900].map((x, k) => (
                <rect
                  key={x}
                  x={x}
                  y={r.y - 11}
                  width={24 + Math.round(rand(r.i * 7 + k) * 34)}
                  height="4"
                  rx="2"
                  fill="var(--ink)"
                  opacity="0.08"
                />
              ))}
            </g>
          ))}
        </g>
      </motion.svg>

      {/* five connectors: order, gateway, payout, bank, books */}
      <motion.svg
        style={reduce ? still : { y: connectorY }}
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1440 800"
        preserveAspectRatio="none"
        fill="none"
      >
        {/* The connector paths are the loudest brand-blue on the page and they
            run behind the headline. Structural, so they sit back. */}
        <g stroke="var(--brand)" strokeOpacity="0.1" strokeWidth="1.4" fill="none">
          <path d="M-40 640 C 320 640, 380 470, 700 470 S 1120 300, 1500 300" />
          <path d="M-40 720 C 300 720, 420 560, 760 560 S 1160 420, 1500 420" />
          <path d="M-40 560 C 360 560, 400 380, 720 380 S 1140 190, 1500 190" />
        </g>
        {/* nodes where a line changes hands */}
        {[
          [700, 470],
          [760, 560],
          [720, 380],
          [1120, 300],
          [1160, 420],
        ].map(([cx, cy]) => (
          <circle
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r="3"
            fill="var(--brand)"
            fillOpacity="0.12"
          />
        ))}
      </motion.svg>

      {/* dot field and grain over the top */}
      <motion.div
        style={reduce ? still : { y: dotsY }}
        className="r-dotgrid absolute inset-[-10%] opacity-[0.3]"
      />
      <div className="r-grain absolute inset-0" />

      {/* readability veil: solid under the copy, open on the right */}
      {/* Opaque under the copy column, then out of the way. The ledger has to
          survive on the right or there is no reason to draw it. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(100deg, var(--paper) 0%, var(--paper) 32%, color-mix(in srgb, var(--paper) 62%, transparent) 52%, transparent 72%)",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-40"
        style={{ background: "linear-gradient(180deg, transparent, var(--paper))" }}
      />
    </div>
  );
}
