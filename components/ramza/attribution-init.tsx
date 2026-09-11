"use client";

import { useEffect } from "react";
import { ensureAttribution } from "@/lib/ramza/attribution";

/* Captures Meta ad params into a first-party cookie on the first visit.
   Renders nothing. */
export function AttributionInit() {
  useEffect(() => {
    ensureAttribution();
  }, []);
  return null;
}
