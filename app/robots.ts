import type { MetadataRoute } from "next";
import { RAMZA_ORIGIN, absoluteUrl } from "@/lib/ramza/site";

/* This Next app serves two things from one origin: the public RAMZA marketing
   site and the private Omnia finance app. Everything in the app is gated by
   middleware.ts, so a crawler only ever gets a redirect to /login — but it
   still spends crawl budget discovering that, and a stray indexed /login is
   noise in the brand's results. Disallow it explicitly. */
const PRIVATE_APP_ROUTES = [
  "/analytics",
  "/api/",
  "/calendar",
  "/confirm",
  "/customers",
  "/documents",
  "/help",
  "/inventory",
  "/login",
  "/logout",
  "/orders",
  "/payouts",
  "/reconciliation",
  "/reports",
  "/returns",
  "/sales",
  "/settings",
  "/tasks",
  "/team",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          ...PRIVATE_APP_ROUTES,
          /* The landing page's headline-variant params. Canonical tags already
             point every variant at bare /ramza; this stops the crawl entirely. */
          "/ramza?h=",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: RAMZA_ORIGIN,
  };
}
