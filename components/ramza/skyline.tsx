/* A quiet Gulf skyline motif — a spire, a couple of towers, a dhow sail.
   Stylised, low-contrast, decorative only. */
export function Skyline({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden
    >
      <g stroke="var(--brand)" strokeOpacity="0.28" strokeWidth="1.5" fill="none">
        {/* dhow sail */}
        <path d="M120 120 L120 44 Q 168 78 150 120 Z" />
        <path d="M120 120 L92 120" />
        {/* low towers */}
        <path d="M300 120 L300 70 L330 70 L330 120" />
        <path d="M345 120 L345 84 L366 84 L366 120" />
        {/* central spire */}
        <path d="M600 120 L588 58 L594 34 L600 22 L606 34 L612 58 L600 120" />
        <path d="M600 22 L600 8" />
        {/* stepped tower */}
        <path d="M840 120 L840 76 L860 76 L860 60 L878 60 L878 76 L898 76 L898 120" />
        {/* right towers */}
        <path d="M980 120 L980 66 L1004 66 L1004 120" />
        <path d="M1020 120 L1020 82 L1038 82 L1038 120" />
      </g>
      <path
        d="M0 120 L1200 120"
        stroke="var(--rule)"
        strokeWidth="1"
      />
    </svg>
  );
}
