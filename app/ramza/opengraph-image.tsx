import { ImageResponse } from "next/og";

export const alt = "RAMZA — payout reconciliation, matched to the bank and closed in Zoho Books";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* The hero's final matched state, static, with the wordmark. Uses the default
   ImageResponse font (no external fetch) to keep the build fast. */
export default function OgImage() {
  const paper = "#ffffff";
  const ink = "#0b1533";
  const ledger = "#2f6bff";
  const rule = "#e3e8f7";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: paper,
          color: ink,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>RAMZA</span>
          <span style={{ fontSize: 24, color: "#5b6472" }}>رمز</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 54, fontWeight: 600, lineHeight: 1.1, maxWidth: 900 }}>
            Every Tabby, Tamara and Telr payout, matched to your bank and closed in Zoho Books.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              border: `1px solid ${rule}`,
              borderRadius: 12,
              padding: "16px 20px",
              fontSize: 26,
              background: "#ffffff",
              // Satori has no fit-content; alignSelf gets the same shrink-wrap
              // and, unlike width:"fit-content", does not abort the build.
              alignSelf: "flex-start",
            }}
          >
            <span style={{ color: "#5b6472" }}>Bank credit</span>
            <span style={{ fontWeight: 600 }}>AED 18,420.50</span>
            <span
              style={{
                background: "rgba(14,122,90,0.14)",
                color: ledger,
                borderRadius: 8,
                padding: "4px 12px",
                fontSize: 20,
                fontWeight: 600,
              }}
            >
              Matched
            </span>
          </div>
        </div>

        <div style={{ fontSize: 22, color: "#5b6472" }}>
          Payout reconciliation for UAE and KSA e-commerce
        </div>
      </div>
    ),
    { ...size },
  );
}
