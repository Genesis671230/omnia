/* Fixed page backdrop: a soft blue wash, a dotted grid, and two blurred
   halos. Pure CSS, sits behind everything. Content in RamzaShell is z-1. */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--brand) 7%, var(--paper)) 0%, var(--paper) 42%, var(--field) 100%)",
        }}
      />
      <div className="r-dotgrid absolute inset-0 opacity-70" />
      {/* Sized in vmax so the halos scale with the viewport instead of hanging
          620px off a 390px phone, which pushed documentElement.scrollWidth to
          628 and gave the page a horizontal scrollbar on mobile. */}
      <div
        className="r-halo"
        style={{
          width: "min(620px, 90vw)",
          height: "min(620px, 90vw)",
          top: "-18vw",
          left: "-14vw",
          background: "var(--halo-a)",
        }}
      />
      <div
        className="r-halo"
        style={{
          width: "min(520px, 80vw)",
          height: "min(520px, 80vw)",
          top: "22vh",
          right: "-16vw",
          background: "var(--halo-b)",
        }}
      />
    </div>
  );
}
