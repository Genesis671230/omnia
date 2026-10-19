import type { Metadata } from "next";
import { CtSiteFrame } from "@/components/ramza/ct/site-frame";
import { PageHero } from "@/components/ramza/ct/sections";
import { ct } from "@/components/ramza/ct/brand";
import { LOGO_DIRECTIONS, LogoStage, RamzaAgentMark } from "@/components/ramza/brand/agent";
import { ctMetadata } from "@/lib/ramza/ct-seo";

/* Brand kit: the agent logo and its six animated directions, each in a light
   and a dark version, plus the files to download. The stages are the live
   SVG/CSS from components/ramza/brand/agent.tsx, so this page is always the
   logo as shipped. */

export const metadata: Metadata = ctMetadata(
  "/ramza/brand",
  "RAMZA brand kit — logo, animations, light and dark — RAMZA",
  "The RAMZA agent logo: a mark whose eyes turn into an equals sign, books = bank. Six animated directions in light and dark, with SVG and PNG downloads.",
);

const FILES = [
  { href: "/ramza/brand/ramza-agent.svg", label: "Mark — light surfaces", kind: "SVG" },
  { href: "/ramza/brand/ramza-agent-dark.svg", label: "Mark — dark surfaces", kind: "SVG" },
  { href: "/ramza/brand/ramza-agent-animated.svg", label: "Animated mark — light", kind: "SVG" },
  { href: "/ramza/brand/ramza-agent-animated-dark.svg", label: "Animated mark — dark", kind: "SVG" },
  { href: "/ramza/brand/ramza-agent-512.png", label: "Mark, transparent", kind: "PNG 512" },
  { href: "/ramza/brand/ramza-agent-on-light-1024.png", label: "Avatar — light", kind: "PNG 1024" },
  { href: "/ramza/brand/ramza-agent-on-dark-1024.png", label: "Avatar — dark", kind: "PNG 1024" },
] as const;

export default function BrandPage() {
  return (
    <CtSiteFrame>
      <PageHero
        eyebrow="Brand kit"
        title={<>The RAMZA agent</>}
        lead="Two eyes that turn into an equals sign: your books and your bank, balanced. Every direction below comes in a light and a dark version."
      />

      <section className={`${ct.sectionLight} py-12 sm:py-16`}>
        <div className={ct.container}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-4 rounded-[20px] bg-[#F4F4F6] p-6">
              <RamzaAgentMark size={64} />
              <span className="font-[family-name:var(--font-display)] text-[34px] font-semibold tracking-[-0.03em] text-[#07090D]">ramza</span>
            </div>
            <div className="flex items-center gap-4 rounded-[20px] bg-[#07090D] p-6">
              <RamzaAgentMark size={64} tone="dark" />
              <span className="font-[family-name:var(--font-display)] text-[34px] font-semibold tracking-[-0.03em] text-white">ramza</span>
            </div>
          </div>

          <div className="mt-14 space-y-14">
            {LOGO_DIRECTIONS.map((d) => (
              <article key={d.id}>
                <header className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <h2 className={ct.h3}>{d.id} — {d.name}</h2>
                  <p className="text-[14px] text-[#55525E]">{d.note}</p>
                </header>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(["light", "dark"] as const).map((theme) => (
                    <figure key={theme} className="overflow-hidden rounded-[20px] ring-1 ring-[#E3E7F0]">
                      <LogoStage direction={d.id} theme={theme} />
                      <figcaption className="border-t border-[#E3E7F0] bg-white px-4 py-2.5 text-[12.5px] text-[#55525E]">
                        {theme === "light" ? "Bright" : "Dark"}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <div className="mt-16">
            <h2 className={ct.h3}>Files</h2>
            <ul className="mt-4 divide-y divide-[#E3E7F0] rounded-[20px] ring-1 ring-[#E3E7F0]">
              {FILES.map((f) => (
                <li key={f.href}>
                  <a href={f.href} download className="flex items-center justify-between px-5 py-3.5 text-[14.5px] text-[#14131C] hover:bg-[#F4F4F6]">
                    <span>{f.label}</span>
                    <span className="text-[12.5px] text-[#55525E]">{f.kind}</span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[13px] text-[#55525E]">Logo blue #3A55E6 (dark surfaces #4D66F0), ink #07090D, canvas #F4F4F6. Keep the eyes white and the corners round; don’t recolour the head per campaign.</p>
          </div>
        </div>
      </section>
    </CtSiteFrame>
  );
}
