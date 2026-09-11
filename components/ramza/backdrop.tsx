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
      <div
        className="r-halo"
        style={{ width: 620, height: 620, top: -220, left: -160, background: "var(--halo-a)" }}
      />
      <div
        className="r-halo"
        style={{ width: 520, height: 520, top: 240, right: -220, background: "var(--halo-b)" }}
      />
    </div>
  );
}
