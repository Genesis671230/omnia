import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentPage } from "@/components/ramza/content-page";
import { allPageParams, getPage } from "@/lib/ramza/pages";
import { pageJsonLd, pageMetadata } from "@/lib/ramza/seo";

/* One route for every /ramza/* content page. Params come from the registry,
   so a page is statically generated the moment it is added to a family file
   and never needs wiring here. */

export const dynamicParams = false;

export function generateStaticParams() {
  return allPageParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getPage(slug.join("/"));
  if (!page) return {};
  return pageMetadata(page);
}

const WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

function whatsappHref(): string {
  if (!WHATSAPP) return "#audit";
  return `https://wa.me/${WHATSAPP.replace(/[^\d]/g, "")}`;
}

export default async function RamzaContentPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const page = getPage(slug.join("/"));
  if (!page) notFound();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageJsonLd(page)) }}
      />
      <ContentPage page={page} whatsappHref={whatsappHref()} />
    </>
  );
}
