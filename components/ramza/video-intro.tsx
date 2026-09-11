"use client";

import { useRef, useState } from "react";
import { Play } from "lucide-react";
import { Section, SectionHeading } from "./ui/section";
import { VIDEO_INTRO_HEADING, VIDEO_INTRO_BODY } from "@/lib/ramza/copy";

/* Click-to-play. The poster carries no weight until the visitor asks for the
   video, so it stays out of the initial load budget. */
export function VideoIntro() {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);

  return (
    <Section>
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
        <div>
          <SectionHeading>{VIDEO_INTRO_HEADING}</SectionHeading>
          <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
            {VIDEO_INTRO_BODY}
          </p>
        </div>

        <div
          className="r-glass relative overflow-hidden rounded-2xl"
          style={{ aspectRatio: "16 / 9" }}
        >
          {!playing ? (
            <button
              type="button"
              onClick={() => {
                setPlaying(true);
                requestAnimationFrame(() => ref.current?.play());
              }}
              aria-label="Play the RAMZA walkthrough"
              className="group absolute inset-0 h-full w-full"
            >
              {/* poster */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/ramza/intro-poster.jpg"
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <span className="absolute inset-0" style={{ background: "rgba(15,26,43,0.28)" }} />
              <span
                className="absolute left-1/2 top-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition-transform group-hover:scale-105"
                style={{ background: "var(--ledger)", color: "var(--ledger-ink)" }}
              >
                <Play className="size-6" style={{ marginLeft: 2 }} fill="currentColor" />
              </span>
            </button>
          ) : (
            <video
              ref={ref}
              className="h-full w-full object-cover"
              controls
              playsInline
              preload="metadata"
              poster="/ramza/intro-poster.jpg"
            >
              <source src="/ramza/intro.mp4" type="video/mp4" />
            </video>
          )}
        </div>
      </div>
    </Section>
  );
}
