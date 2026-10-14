"use client";

/* The industry a visitor picked — shared by the hero demo, the live panels
 * and the tools, and remembered for their next visit. ?industry=logistics in
 * an ad link preselects it. */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { INDUSTRIES, INDUSTRY_LABEL, type Industry } from "@/lib/ramza/demo/coa";
import { funnel } from "@/lib/ramza/funnel";

const KEY = "ramza_industry";
const Ctx = createContext<{ industry: Industry; setIndustry: (i: Industry, from?: string) => void }>({ industry: "ecommerce", setIndustry: () => {} });

export function IndustryProvider({ children }: { children: ReactNode }) {
  const [industry, set] = useState<Industry>("ecommerce");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("industry");
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* storage blocked */ }
    const pick = [q, saved].find((x) => x && (INDUSTRIES as readonly string[]).includes(x)) as Industry | undefined;
    if (pick) set(pick);
    funnel("page_view", { industry: pick ?? "ecommerce", ref: document.referrer ? new URL(document.referrer).hostname : "" });
  }, []);
  const setIndustry = (i: Industry, from = "chips") => {
    set(i);
    try { localStorage.setItem(KEY, i); } catch { /* storage blocked */ }
    funnel("industry_pick", { industry: i, from });
  };
  return <Ctx.Provider value={{ industry, setIndustry }}>{children}</Ctx.Provider>;
}

export const useIndustry = () => useContext(Ctx);

export function IndustryChips({ className = "", from = "chips", dark = false }: { className?: string; from?: string; dark?: boolean }) {
  const { industry, setIndustry } = useIndustry();
  return (
    <div className={`flex flex-wrap justify-center gap-1.5 ${className}`} role="radiogroup" aria-label="Your industry">
      {INDUSTRIES.map((i) => {
        const on = i === industry;
        return (
          <button key={i} role="radio" aria-checked={on} onClick={() => setIndustry(i, from)}
            className={`h-9 rounded-full px-3.5 text-[13.5px] font-medium transition ${on
              ? dark ? "bg-white text-[#14131C]" : "bg-[#0B1533] text-white"
              : dark ? "text-white/75 ring-1 ring-white/20 hover:bg-white/10" : "bg-white text-[#55525E] ring-1 ring-[#DDE2EC] hover:text-[#14131C] hover:ring-[#14131C]/30"}`}>
            {INDUSTRY_LABEL[i]}
          </button>
        );
      })}
    </div>
  );
}
