"use client";

/* Small tracking wrappers so server sections stay server components:
 *   <TrackView section="case-study" event="ViewContent">…</TrackView>
 *   <WhatsAppLink href={…} placement="hero">WhatsApp us</WhatsAppLink> */

import { useEffect, useRef, type ReactNode } from "react";
import { trackOnce } from "@/lib/ramza/track";
import { funnel } from "@/lib/ramza/funnel";

export function TrackView({ section, event = "SectionView", children, className }: { section: string; event?: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { trackOnce(`view:${section}`, event, { section }); io.disconnect(); }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [section, event]);
  return <div ref={ref} className={className}>{children}</div>;
}

export function WhatsAppLink({ href, placement, className, children }: { href: string; placement: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={className} onClick={() => funnel("whatsapp_click", { placement })}>
      {children}
    </a>
  );
}
