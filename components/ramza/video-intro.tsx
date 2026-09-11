"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Play, X } from "lucide-react";
import { Section, SectionHeading } from "./ui/section";
import { VIDEO_INTRO_HEADING, VIDEO_INTRO_BODY } from "@/lib/ramza/copy";

/* Two states, one asset.

   Resting: the poster, with the video attached but not downloading. On hover
   (pointer devices) or once the card is well inside the viewport (touch), it
   plays a muted, looping, controls-free preview so the card reads as motion
   rather than as a screenshot. Click opens the real thing full-screen with
   sound and controls.

   The lightbox goes through a portal so no ancestor's transform, filter or
   overflow can trap a position:fixed overlay — the failure mode this codebase
   has hit before with modals. */
export function VideoIntro() {
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [mounted, setMounted] = useState(false);

  const previewRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  /* Touch devices get the preview from proximity instead of hover. */
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    if (window.matchMedia("(hover: hover)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const io = new IntersectionObserver(
      ([entry]) => setPreviewing(entry.isIntersecting),
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const v = previewRef.current;
    if (!v) return;
    if (previewing && !open) {
      v.play().catch(() => {
        /* autoplay refused: the poster is still a fine resting state */
      });
    } else {
      v.pause();
    }
  }, [previewing, open]);

  const startPreview = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setPreviewing(true);
  }, []);

  return (
    <Section>
      <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:gap-14">
        <div>
          <span className="r-eyebrow inline-flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-px w-8"
              style={{ background: "var(--ledger)" }}
            />
            Walkthrough
          </span>
          <SectionHeading>{VIDEO_INTRO_HEADING}</SectionHeading>
          <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
            {VIDEO_INTRO_BODY}
          </p>
          <p className="mt-5 text-[0.8125rem]" style={{ color: "var(--ink-40)" }}>
            Runs 58 seconds. Real payout files, numbers changed.
          </p>
        </div>

        <div
          ref={cardRef}
          onMouseEnter={startPreview}
          onMouseLeave={() => setPreviewing(false)}
        >
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(true)}
            onFocus={startPreview}
            onBlur={() => setPreviewing(false)}
            aria-label="Play the RAMZA walkthrough full screen"
            className="r-video-card group relative block w-full overflow-hidden rounded-[1.5rem]"
            style={{ aspectRatio: "16 / 9" }}
          >
            <video
              ref={previewRef}
              className="h-full w-full object-cover"
              muted
              loop
              playsInline
              preload="none"
              poster="/ramza/intro-poster.jpg"
              tabIndex={-1}
              aria-hidden
            >
              <source src="/ramza/intro.mp4" type="video/mp4" />
            </video>

            {/* legibility veil, lifts on hover so the preview breathes */}
            <span
              aria-hidden
              className="absolute inset-0 transition-opacity duration-500"
              style={{
                background:
                  "linear-gradient(180deg, rgba(9,16,40,0.10) 0%, rgba(9,16,40,0.52) 100%)",
                opacity: previewing ? 0.55 : 1,
              }}
            />

            <span
              aria-hidden
              className="r-video-play absolute left-1/2 top-1/2 flex size-[4.5rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
            >
              <Play className="size-6" style={{ marginLeft: 3 }} fill="currentColor" />
            </span>

            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-5 py-4 text-left"
            >
              <span className="text-[0.8125rem] font-semibold text-white/95">
                March close, start to finish
              </span>
              <span className="tnum text-[0.75rem] font-medium text-white/70">0:58</span>
            </span>
          </button>
        </div>
      </div>

      {mounted &&
        open &&
        createPortal(
          <Lightbox
            onClose={() => {
              setOpen(false);
              triggerRef.current?.focus();
            }}
          />,
          document.body,
        )}
    </Section>
  );
}

function Lightbox({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    videoRef.current?.play().catch(() => {});

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      /* Two focusable children, so a manual wrap is cheaper than a library. */
      if (e.key === "Tab") {
        e.preventDefault();
        const els = [closeRef.current, videoRef.current].filter(Boolean) as HTMLElement[];
        const i = els.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? i - 1 : i + 1;
        els[(next + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="RAMZA walkthrough"
      className="r-lightbox"
      onClick={onClose}
    >
      <div
        className="r-lightbox-frame"
        onClick={(e) => e.stopPropagation()}
      >
        <video
          ref={videoRef}
          className="h-full w-full rounded-[0.9rem] bg-black object-contain"
          controls
          playsInline
          preload="auto"
          poster="/ramza/intro-poster.jpg"
        >
          <source src="/ramza/intro.mp4" type="video/mp4" />
        </video>
      </div>

      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close the walkthrough"
        className="r-lightbox-close"
      >
        <X className="size-5" />
      </button>
    </div>
  );
}
