"use client";

/* ?ramza_debug=1 — a corner panel showing which pixels actually loaded on
 * this page and every funnel event as it fires. For checking tracking on the
 * live site after the pixel IDs are set; invisible otherwise. */

import { useEffect, useState } from "react";
import { debugEvents, onDebug } from "@/lib/ramza/funnel";

export function TrackingDebug() {
  const [on, setOn] = useState(false);
  const [, force] = useState(0);
  const [px, setPx] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("ramza_debug") !== "1") return;
    setOn(true);
    const read = () => setPx({ "Meta Pixel": Boolean(window.fbq), "TikTok": Boolean(window.ttq), "GTM / dataLayer": Array.isArray(window.dataLayer) && window.dataLayer.some((e) => "gtm.start" in e), "Google Ads": Boolean(window.gtag) });
    read();
    const t = setInterval(read, 1500);
    const off = onDebug(() => force((x) => x + 1));
    return () => { clearInterval(t); off(); };
  }, []);
  if (!on) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] w-[300px] rounded-2xl bg-[#0B1533] p-3 text-[11.5px] text-white shadow-2xl">
      <div className="mb-2 font-semibold">RAMZA tracking</div>
      {Object.entries(px).map(([k, v]) => <div key={k} className="flex justify-between"><span>{k}</span><span className={v ? "text-[#34D399]" : "text-[#F87171]"}>{v ? "loaded" : "not loaded"}</span></div>)}
      <div className="mt-2 border-t border-white/10 pt-2 text-white/60">First-party events → /api/lead/events</div>
      <div className="mt-1 max-h-[220px] space-y-1 overflow-auto">
        {debugEvents().map((e, i) => <div key={i} className="rounded bg-white/5 px-2 py-1"><b>{e.name}</b> <span className="text-white/50">{e.at}</span><div className="truncate text-white/50">{JSON.stringify(e.props)}</div></div>)}
      </div>
    </div>
  );
}
