/* Navigation + contact for the RAMZA Corporate Tax site. One list so the nav,
   footer and sitemap never disagree. */

export const CT_NAV = [
  { href: "/ramza#e-invoicing", label: "E-invoicing" },
  { href: "/ramza#how", label: "How it works" },
  { href: "/ramza/reconcile", label: "Reconcile tool" },
  { href: "/ramza#tools", label: "Free tools" },
  { href: "/ramza/services", label: "Services" },
  { href: "/ramza/penalty-checker", label: "Penalty checker" },
  { href: "/ramza/corporate-tax-penalties", label: "Penalties" },
] as const;

export const CT_PENALTY_LINKS = [
  { href: "/ramza/reconsideration", label: "40-day reconsideration" },
  { href: "/ramza/late-registration-waiver", label: "Registration waiver" },
] as const;

export const CT_MORE = [
  { href: "/ramza/contact", label: "Contact" },
  { href: "/ramza/payout-reconciliation", label: "Payout reconciliation" },
  { href: "/privacy", label: "Privacy" },
] as const;

export function whatsappHref(text = "Hi RAMZA, I need help with my Corporate Tax."): string {
  const n = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  if (!n) return "/ramza/contact";
  return `https://wa.me/${n.replace(/[^\d]/g, "")}?text=${encodeURIComponent(text)}`;
}
