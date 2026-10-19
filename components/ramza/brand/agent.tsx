/* RAMZA agent logo (2026-10-19): a blue squircle with two eyes that blink,
 * look around and turn into an equals sign — books = bank. Replaces the
 * bracket mark of 2026-10-17 (its files stay in public/ramza/brand/).
 *
 * <RamzaAgentMark> is the logo itself (nav, footer, app rail). <LogoStage>
 * renders one of the six animated directions from "RAMZA Logo Directions",
 * each in a light and a dark version, for /ramza/brand and social exports.
 * Pure SVG + CSS keyframes (agent.css): no JS, server-renderable, and every
 * animation rests on the plain mark under prefers-reduced-motion. */

import "./agent.css";
import { FeedCounter } from "./feed-counter";

export const AGENT_BLUE = "#3A55E6";

export type LogoTheme = "light" | "dark";

const THEME = {
  light: { bg: "#F4F4F6", ink: "#07090D", sub: "#3E4856", shadow: "#07090D", shadowOp: 0.12 },
  dark: { bg: "#07090D", ink: "#FFFFFF", sub: "#A7B0BF", shadow: "#FFFFFF", shadowOp: 0.1 },
} as const;

/* The 200-unit head from the source file: a 160 squircle at (20,20) with two
   22×50 eyes. Every direction reuses it so the mark never drifts. */
function Head({ fill = AGENT_BLUE, eye = "#FFFFFF", l, r }: { fill?: string; eye?: string; l?: string; r?: string }) {
  return (
    <>
      <rect x="20" y="20" width="160" height="160" rx="54" fill={fill} />
      <rect className={l} x="68" y="72" width="22" height="50" rx="11" fill={eye} />
      <rect className={r} x="110" y="72" width="22" height="50" rx="11" fill={eye} />
    </>
  );
}

/* The logo. `tone` is the surface it sits on: "light" for white/grey pages,
   "dark" for navy/ink ones (brighter blue so it doesn't sink into navy). */
export function RamzaAgentMark({
  size = 28,
  tone = "light",
  animated = true,
  title,
}: {
  size?: number;
  tone?: LogoTheme;
  animated?: boolean;
  title?: string;
}) {
  const fill = tone === "dark" ? "#4D66F0" : AGENT_BLUE;
  return (
    <svg
      width={size}
      height={size}
      viewBox="20 20 160 160"
      className={`shrink-0 ${animated ? "ra-motion" : ""}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <Head fill={fill} l={animated ? "ra-eye ra-idle-l" : undefined} r={animated ? "ra-eye ra-idle-r" : undefined} />
    </svg>
  );
}

export const LOGO_DIRECTIONS = [
  { id: 1, name: "Spring drop", note: "Drops in with squash and stretch, blinks, looks around, snaps its eyes into an equals sign." },
  { id: 2, name: "Aurora glow", note: "Gradient head and halo; the glow surges when the eyes form the equals sign." },
  { id: 3, name: "Payout feed", note: "Stripe, Tabby, Tamara and COD chips fly in; the eyes track each one, then balance." },
  { id: 4, name: "Wordmark reveal", note: "Pops in, forms the equals sign, then slides aside as the wordmark appears." },
  { id: 5, name: "Books + Bank merge", note: "An ink head (books) and a blue head (bank) eye each other and merge into one." },
  { id: 6, name: "Sticker", note: "Sticker cut-out that wobbles, winks, and pops a books = bank tag." },
] as const;

export type LogoDirectionId = (typeof LOGO_DIRECTIONS)[number]["id"];

/* One direction on a square 640 stage, scaled to its container's width. */
export function LogoStage({ direction, theme, label }: { direction: LogoDirectionId; theme: LogoTheme; label?: string }) {
  const t = THEME[theme];
  const name = LOGO_DIRECTIONS.find((d) => d.id === direction)!.name;
  const aria = label ?? `RAMZA logo — ${name}, ${theme} version`;
  const bg = direction === 6 ? (theme === "light" ? "#FF6A1A" : "#07090D") : direction === 4 && theme === "light" ? "#FFFFFF" : t.bg;

  return (
    <svg viewBox="0 0 640 640" className="ra-motion block h-auto w-full" role="img" aria-label={aria} style={{ background: bg }}>
      <rect width="640" height="640" fill={bg} />
      {direction === 1 && <SpringDrop t={t} />}
      {direction === 2 && <Aurora theme={theme} />}
      {direction === 3 && <PayoutFeed t={t} />}
      {direction === 4 && <WordmarkReveal t={t} />}
      {direction === 5 && <Merge t={t} theme={theme} />}
      {direction === 6 && <Sticker theme={theme} />}
    </svg>
  );
}

type T = (typeof THEME)[LogoTheme];

function SpringDrop({ t }: { t: T }) {
  return (
    <svg x="130" y="82" width="380" height="475" viewBox="0 -40 200 250" overflow="visible">
      <ellipse className="ra-sp-sh" cx="100" cy="196" rx="62" ry="7" fill={t.shadow} />
      <g className="ra-sp-head">
        <Head l="ra-eye ra-idle-l" r="ra-eye ra-idle-r" />
      </g>
    </svg>
  );
}

function Aurora({ theme }: { theme: LogoTheme }) {
  const id = `ra-au-${theme}`;
  return (
    <svg x="90" y="90" width="460" height="460" viewBox="-40 -40 280 280" overflow="visible">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2F6BFF" />
          <stop offset=".45" stopColor="#7B5CFF" />
          <stop offset=".78" stopColor="#FF4D8D" />
          <stop offset="1" stopColor="#FF9A3D" />
        </linearGradient>
        <filter id={`${id}-blur`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="24" />
        </filter>
      </defs>
      <g opacity={theme === "light" ? 0.5 : 1}>
        <circle className="ra-au-glow" cx="100" cy="104" r="88" fill={`url(#${id}-g)`} filter={`url(#${id}-blur)`} />
      </g>
      <g className="ra-au-orbit">
        <circle cx="214" cy="100" r="5" fill="#FF9A3D" />
        <circle cx="43" cy="199" r="3.5" fill="#FF4D8D" />
        <circle cx="43" cy="1" r="3" fill="#2F6BFF" />
      </g>
      <g className="ra-au-head">
        <Head fill={`url(#${id}-g)`} l="ra-eye ra-idle-l" r="ra-eye ra-idle-r" />
      </g>
    </svg>
  );
}

function Chip({ cls, x, y, fill, text, ink }: { cls: string; x: number; y: number; fill: string; text: string; ink: string }) {
  return (
    <g className={`ra-ch ${cls}`}>
      <rect x={x} y={y} width="78" height="28" rx="14" fill={fill} />
      <text x={x + 39} y={y + 19} textAnchor="middle" fontSize="13" fontWeight="600" fill={ink}>{text}</text>
    </g>
  );
}

function PayoutFeed({ t }: { t: T }) {
  return (
    <>
      <svg x="20" y="150" width="600" height="265" viewBox="-160 -20 520 230" overflow="visible">
        <ellipse cx="100" cy="196" rx="62" ry="7" fill={t.shadow} fillOpacity={t.shadowOp} />
        <Chip cls="ra-ch-l1" x={-150} y={48} fill="#7B5CFF" text="Stripe" ink="#FFFFFF" />
        <Chip cls="ra-ch-r1" x={212} y={124} fill="#2CD9A5" text="Tabby" ink="#07090D" />
        <Chip cls="ra-ch-l2" x={-150} y={124} fill="#FF4D8D" text="Tamara" ink="#FFFFFF" />
        <Chip cls="ra-ch-r2" x={212} y={48} fill="#FFB547" text="COD" ink="#07090D" />
        <g className="ra-f-head">
          <Head l="ra-f-l" r="ra-f-r" />
        </g>
      </svg>
      <text x="320" y="470" textAnchor="middle">
        <tspan fontSize="30" fontWeight="500" fill={t.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
          <FeedCounter />
        </tspan>
        <tspan dx="10" fontSize="17" fontWeight="500" fill={t.sub}>payouts matched</tspan>
      </text>
    </>
  );
}

function WordmarkReveal({ t }: { t: T }) {
  /* Final lockup: 150 head + 22 gap + the wordmark, centred on the stage. The
     head starts centred (translateX 136) and slides into place. */
  return (
    <>
      <defs>
        <clipPath id="ra-rv-clip"><rect x="276" y="200" width="330" height="140" /></clipPath>
      </defs>
      <g transform="translate(104 200)">
        <g className="ra-rv-head" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          <svg width="150" height="150" viewBox="20 20 160 160">
            <Head l="ra-rv-l" r="ra-rv-r" />
          </svg>
        </g>
      </g>
      <g clipPath="url(#ra-rv-clip)">
        <text className="ra-rv-word" x="278" y="309" fontSize="96" fontWeight="600" letterSpacing="-4.8" fill={t.ink} style={{ transformBox: "fill-box" }}>
          ramza
        </text>
      </g>
      <text className="ra-rv-tag" x="320" y="410" textAnchor="middle" fontSize="20" fontWeight="500" fill={t.sub}>
        your books, balanced.
      </text>
    </>
  );
}

function Merge({ t, theme }: { t: T; theme: LogoTheme }) {
  const books = theme === "light" ? "#07090D" : "#E8EBF3";
  const booksEye = theme === "light" ? "#FFFFFF" : "#07090D";
  return (
    <>
      <svg x="20" y="130" width="600" height="343" viewBox="-110 -30 420 240" overflow="visible">
        <ellipse cx="100" cy="196" rx="62" ry="7" fill={t.shadow} fillOpacity={t.shadowOp * 0.8} />
        <g className="ra-mg-ink">
          <Head fill={books} eye={booksEye} l="ra-mi" r="ra-mi" />
        </g>
        <g className="ra-mg-blue">
          <Head l="ra-mb-l" r="ra-mb-r" />
        </g>
      </svg>
      <g fontSize="18" fontWeight="600">
        <text className="ra-lb-a" x="196" y="510" textAnchor="middle" fill={t.ink}>books</text>
        <text className="ra-lb-b" x="444" y="510" textAnchor="middle" fill={theme === "light" ? AGENT_BLUE : "#8FA0FF"}>bank</text>
        <text className="ra-lb-c" x="320" y="510" textAnchor="middle" fill={t.ink}>balanced.</text>
      </g>
    </>
  );
}

function Sticker({ theme }: { theme: LogoTheme }) {
  const light = theme === "light";
  const drop = light ? "#07090D" : "#FF6A1A";
  return (
    <svg x="60" y="87" width="520" height="466" viewBox="-40 -30 290 260" overflow="visible">
      <path className="ra-st-spk" d="M-12,6 C-10,18 -6,22 6,24 C-6,26 -10,30 -12,42 C-14,30 -18,26 -30,24 C-18,22 -14,18 -12,6 Z" fill="#FFFFFF" />
      <path className="ra-st-spk ra-st-spk2" d="M212,150 C213.5,159 216.5,162 225,163.5 C216.5,165 213.5,168 212,177 C210.5,168 207.5,165 199,163.5 C207.5,162 210.5,159 212,150 Z" fill={light ? "#07090D" : "#FF6A1A"} />
      <g className="ra-st-wob">
        <rect x="20" y="20" width="160" height="160" rx="54" fill={drop} transform="translate(10,10)" />
        <rect x="11" y="11" width="178" height="178" rx="62" fill="#FFFFFF" />
        <Head l="ra-eye ra-st-l" r="ra-eye ra-st-r" />
      </g>
      <g className="ra-st-pill">
        <rect x="104" y="166" width="120" height="36" rx="18" fill="#FFFFFF" stroke={light ? "#07090D" : "#FF6A1A"} strokeWidth="3" />
        <text x="164" y="189.5" textAnchor="middle" fontSize="16" fontWeight="600" fill="#07090D">books = bank</text>
      </g>
    </svg>
  );
}
