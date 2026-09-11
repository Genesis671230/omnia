"use client";

import { useEffect, useState } from "react";

/* Hero background media. Desktop (and no reduced-motion) gets a silent 1 MB
   video loop; everything else gets the poster only — so phone Lighthouse never
   pays for the video. Rendered poster-first on the server, video swapped in
   after mount when the viewport qualifies. */
export function HeroBg() {
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setShowVideo(wide.matches && !reduce.matches);
    update();
    wide.addEventListener("change", update);
    reduce.addEventListener("change", update);
    return () => {
      wide.removeEventListener("change", update);
      reduce.removeEventListener("change", update);
    };
  }, []);

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      {showVideo ? (
        <video
          className="h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster="/ramza/hero-poster.jpg"
        >
          <source src="/ramza/hero-bg.mp4" type="video/mp4" />
        </video>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/ramza/hero-poster.jpg" alt="" className="h-full w-full object-cover" />
      )}

      {/* readability veil: opaque on the left (copy), lighter on the right */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(100deg, var(--paper) 0%, color-mix(in srgb, var(--paper) 82%, transparent) 46%, color-mix(in srgb, var(--paper) 40%, transparent) 100%)",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-40"
        style={{ background: "linear-gradient(180deg, transparent, var(--paper))" }}
      />
      <div className="r-dotgrid absolute inset-0 opacity-50" />
    </div>
  );
}
