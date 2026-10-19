import { ImageResponse } from "next/og";
import { allPageParams, getHub, getPage, hubFor } from "@/lib/ramza/pages";

/* GET /ramza/og/<page path>.png — a social card per content page and hub: the agent mark, the section, the
   page's own headline. A shared generic card makes every link to the site
   look the same in a feed; the headline is what earns the click. Default
   ImageResponse font, no external fetch, so the build stays offline. */

/* Not an opengraph-image file: Next forbids those under a catch-all segment.
   Referenced from pageMetadata/hubMetadata via ogImagePath(). */
const size = { width: 1200, height: 630 };

export const dynamic = "force-static";

export function generateStaticParams() {
  return allPageParams().map(({ slug }) => ({ slug: [...slug.slice(0, -1), `${slug.at(-1)}.png`] }));
}

const MARK =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 20 160 160"><rect x="20" y="20" width="160" height="160" rx="54" fill="#3A55E6"/><rect x="68" y="72" width="22" height="50" rx="11" fill="#fff"/><rect x="110" y="72" width="22" height="50" rx="11" fill="#fff"/></svg>',
  ).toString("base64");

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const path = slug.join("/").replace(/\.png$/, "");
  const hub = getHub(path);
  const page = hub ? undefined : getPage(path);
  const section = hub ? "RAMZA" : page ? (hubFor(page.family)?.crumb ?? "RAMZA") : "RAMZA";
  const headline = hub?.h1 ?? page?.h1 ?? "Your books, balanced.";
  const updated = page?.updated;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#F4F4F6", color: "#07090D", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MARK} width={64} height={64} alt="" />
          <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>ramza</span>
          <span style={{ marginLeft: 12, fontSize: 22, color: "#3E4856", border: "1px solid #D9DEE8", borderRadius: 999, padding: "6px 18px", background: "#FFFFFF" }}>{section}</span>
        </div>
        <div style={{ display: "flex", fontSize: headline.length > 60 ? 56 : 66, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1.5, maxWidth: 1000 }}>
          {headline}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: "#3E4856" }}>
          <span>AI bookkeeping for UAE and KSA businesses, checked by accountants</span>
          {updated ? <span>Reviewed {updated}</span> : <span />}
        </div>
      </div>
    ),
    { ...size },
  );
}
