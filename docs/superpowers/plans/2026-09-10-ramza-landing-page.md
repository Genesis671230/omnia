# RAMZA landing page — implementation plan

> Status: **built** 2026-09-10 (approved as written). All 10 tasks done, plus a
> 2026-09-10 follow-up adding three media sections (see below). Open items: OG
> image unverified locally (dev server was CPU-pegged), Lighthouse/60fps pass
> needs a healthy environment, and the founder placeholders below.
>
> **2026-09-10 media follow-up.** Founder asked to add competitors' video assets
> (Truewind hero webm, Framer CDN webms/images). Declined — third-party IP and it
> contradicts the brief's synthetic-only rule. Built original instead:
> - `components/ramza/video-intro.tsx` — click-to-play walkthrough. Source
>   `rama-intro.mp4` (founder's own footage, 53MB, repo root) compressed with
>   ffmpeg to `public/ramza/intro.mp4` (6MB, 720p, faststart) + `intro-poster.jpg`.
>   Raw source git-ignored (`/rama-intro.mp4`).
> - `components/ramza/orchestrator.tsx` — "one orchestrator, four specialists"
>   (Reconciler, Bill handler, Consolidator, Reporter). Connectors draw in
>   sequence, specialists light up. Original SVG + DOM, pause on tab hidden,
>   reduced-motion → fully-lit end state.
> - `components/ramza/posting-stack.tsx` — "every line gets an account and a
>   date": synthetic rows drop onto a stack, each account chip flips
>   suggested → posted. Original, same motion rules.
> Page order now: Hero, VideoIntro, PainStrip, ContrastLine, HowItWorks,
> Orchestrator, AccountantView, PostingStack, Copilot, Integrations, AuditForm,
> FoundingPartners, Faq.
>
> **2026-09-10 reskin (approved: whole-page, "balance" perf).** Founder rejected
> the ledger-paper look. New direction: LiveFlow-style blue, glass surfaces,
> dotted-grid fields, framer-motion section reveals, Awwwards-SaaS feel, subtle
> UAE motif. This overrides the brief's "no gradient washes / stays quiet /
> green primary" rules.
> - `app/ramza/ramza.css` fully rewritten: blue tokens (`--brand #2f6bff`), glass
>   (`.r-glass` backdrop-blur), `.r-dotgrid`, halos, `@keyframes r-pulse`.
>   `--ledger`/`--ledger-ink` kept as aliases → blue, so components didn't all
>   need touching.
> - `components/ramza/backdrop.tsx` — fixed gradient + dotgrid + 2 halos, in
>   RamzaShell behind `z-[1]` content.
> - `components/ramza/reveal.tsx` — subtle in-view reveal (opacity + small y +
>   blur lift, once), reduced-motion safe.
> - Hero rebuilt: smaller `.r-h1` scale (was clamp→4rem, now →3.4rem), glass
>   copy card overlapping the reconciliation animation, `hero-bg.tsx` (1 MB
>   silent loop on desktop / poster on mobile per the "balance" call),
>   `skyline.tsx` UAE motif.
> - All section cards → `r-glass`; `field` sections get the tinted dotgrid
>   panel; chain + orchestrator connectors now dashed with a travelling pulse.
> - Video encodes: `public/ramza/hero-bg.mp4` (1.0M), `hero-poster.jpg` (77K),
>   `intro.mp4` (5.0M click-to-play), `intro-poster.jpg`. Raw `rama-intro.mp4`
>   git-ignored.
> - Verified: tsc clean, `/ramza` + `?h=` + `/privacy` all 200, no competitor
>   names in output, assets serve with range support. NOT verified: the visual
>   result (Chrome bridge unavailable), Lighthouse, 60fps.

**Goal:** Ship a single conversion-focused landing page for RAMZA (payout reconciliation for Gulf e-commerce) whose job is to get a qualified lead to request the free payout audit, book a 20-minute call, or tap WhatsApp. Mobile-first, Meta-ads traffic, Lighthouse ≥ 95 perf + a11y.

**Positioning:** RAMZA reconciles e-commerce payouts. Order → Gateway → Payout → Bank → Books. Matches Tabby/Tamara/Telr/Stripe/COD payouts to the bank statement and posts payments, gateway fees and VAT on fees into Zoho Books so invoices close automatically. This is a narrower product than the earlier "numio" full-accounting page — payout reconciliation only.

## Decisions locked with the founder (2026-09-10)

| Question | Decision |
|---|---|
| Design expressiveness | **Follow the brief as written.** No animated gradient backdrop. The hero reconciliation animation + one scroll-draw chain are the only orchestrated motion. Everything else quiet: hairlines, whitespace, left-aligned. |
| Imagery | **Crafted product UI, no photos.** Synthetic RAMZA UI surfaces rendered as real DOM/SVG. No stock photos, no people, no logos. |
| AI copilot | **Section + canned interactive demo.** A "RAMZA copilot" section with a realistic chat panel; preset questions expand to show the copilot tracing a payout gap. Not wired to a model. AI never appears in the H1. |
| Location | **New route in this repo.** `/ramza`, `/privacy`, `/api/lead` inside omnia-finance-os. Meta Pixel scoped to the `/ramza` subtree. Structured so it can be extracted to its own project later. |

## Deviations from the brief (explicit)

1. **Added section: "RAMZA copilot"** (canned interactive demo), placed after "What your accountant sees", before "Integrations". Consistent with the brief's "AI can appear in supporting" rule; does not touch the H1.
2. Everything else follows the brief. The founder's note asking for a gradient-flow backdrop and page-wide animation is **overridden by the brief's own guardrails**, per the decision above.

## Guardrails carried into every task

- No client names, logos, testimonials, "trusted by", real order numbers, real amounts, real bank names. **All demo data synthetic.**
- Claim only: Shopify, WooCommerce, Stripe, Telr, Tabby, Tamara, Checkout.com, COD couriers, Zoho Books, AED/SAR multi-currency. Xero/QuickBooks = "on request".
- Do **not** claim: SOC 2, ISO, "bank-level encryption", hosting region, accuracy %, customer counts, time-saved stats, AI model names.
- No gateway logos. Text chips only.
- Footer uses `LEGAL_LINE` placeholder, no legal entity name.
- Do not lead with "AI" in the H1.
- `db/schema.sql` edits do not touch the live DB — the table task runs `node db/apply-schema.mjs` explicitly (project `schema_migration_workflow` note).
- Monetary math in synthetic scenarios must foot exactly; arithmetic stated in code comments.

---

## Design tokens

Scoped under `[data-ramza]` (cannot touch the app's global `:root`, which is the warm-cream omnia theme). Defined in `app/ramza/ramza.css`, imported by `app/ramza/layout.tsx`.

```css
[data-ramza] {
  --paper:    #F5F7F4;  /* page background */
  --ink:      #0F1A2B;  /* text, wordmark */
  --ledger:   #0E7A5A;  /* matched, paid, primary buttons */
  --residual: #C98A12;  /* fees, pending, unmatched */
  --stamp:    #B42318;  /* overdue, missing money */
  --rule:     #D5DBD6;  /* hairlines, table borders */
  --ink-60:   color-mix(in srgb, var(--ink) 60%, var(--paper));
  --ledger-ink: #FFFFFF;   /* text on --ledger buttons */
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  [data-ramza]:not([data-theme="light"]) {
    --paper:    #0E1624;  /* deep navy, not #111 */
    --ink:      #E8EDE9;
    --ledger:   #1FA37A;
    --residual: #E0A231;
    --stamp:    #E5573F;
    --rule:     #24314A;
    --ink-60:   color-mix(in srgb, var(--ink) 60%, var(--paper));
    --ledger-ink: #06231A;
    color-scheme: dark;
  }
}
```

Contrast check (to verify at build): ink/paper, ink-60/paper, ledger-ink/ledger, stamp/paper, residual text only on paper (not as small text on ledger). All pairings must hit AA.

### Type

- One family: **IBM Plex Sans** (Latin) + **IBM Plex Sans Arabic** (wordmark only for now). `next/font/google`, `display: "swap"`, `adjustFontFallback` on. No monospace.
- H1: `clamp(2.25rem, 5vw, 4rem)`, weight 600, line-height 1.05.
- Section headings (h2): `clamp(1.5rem, 3vw, 2rem)`, weight 600.
- Body: 17–18px, line-height 1.55, measure max `68ch`.
- Numbers everywhere: `font-variant-numeric: tabular-nums` (utility class `.tnum`).
- Sentence case everywhere. No ALL-CAPS tracked eyebrows. No accent-colour word in the H1. No "→" on buttons.

### Motion inventory (the whole page)

| Element | Trigger | Notes |
|---|---|---|
| Hero reconciliation | autoplay loop, 3 scenarios | pause on hover + tab hidden; reduced-motion → static final state of scenario 1 |
| Chain draw (Order→…→Books) | scroll into view, once | only scroll-triggered motion on the page |
| FAQ accordion | on open/close | height + opacity only |
| Copilot demo | on click of a preset question | expand the answer trace; no autoplay |
| Nav | scroll past hero | collapse to wordmark + CTA; `transform` only |

No fade-and-slide-up on section entry. No parallax. No hover motion on cards.

---

## Wireframes

### Mobile (360px — build and test this first)

```
┌───────────────────────────────┐
│ RAMZA رمز        [audit] (wa) │  sticky; after hero → wordmark + [audit] + wa
├───────────────────────────────┤
│                               │
│ Every Tabby, Tamara and Telr  │  H1, left-aligned, tight
│ payout, matched to your bank   │
│ and closed in Zoho Books.      │
│                               │
│ RAMZA reads your store orders, │  sub, max 68ch
│ payout files and bank …        │
│                               │
│ [ Get a free payout audit ]   │  full-width primary (ledger)
│ [ Chat on WhatsApp ]          │  full-width secondary (outline)
│                               │
│ ┌───────────────────────────┐ │
│ │  HERO RECONCILIATION      │ │  portrait, compact
│ │  bank credit row  [Unmatch]│ │
│ │  ┌ Tabby payout file ────┐ │ │
│ │  │ order row             │ │ │
│ │  │ order row  … +37 more │ │ │
│ │  └──────────────────────┘ │ │
│ │  connector → [Matched]    │ │
│ │  [Bank charges 584+29.20] │ │
│ │  invoices: Paid ×42       │ │
│ └───────────────────────────┘ │
├───────────────────────────────┤
│ Pain strip (3 statements)     │  stacked, hairline between, no icons
│  ─────                         │
│  Tabby and Tamara pay you net… │
│  ─────                         │
│  A refund next month reopens…  │
│  ─────                         │
│  Five gateways, two currencies…│
├───────────────────────────────┤
│ Dashboards show you the gap.   │  contrast line, large, full width
│ RAMZA closes it.               │
├───────────────────────────────┤
│ How it works                   │
│ 1 Connect your stores          │
│ 2 Send your payout files       │
│ 3 Match to the bank            │
│ 4 Close in Zoho                │
│                               │
│  Order                         │  CHAIN DRAW (vertical on mobile)
│   │                            │  draws once on scroll-in
│  Gateway                       │
│   │                            │
│  Payout                        │
│   │                            │
│  Bank                          │
│   │                            │
│  Books                         │
├───────────────────────────────┤
│ What your accountant sees      │
│  short paragraph               │
│  ┌───────────────────────────┐ │
│  │ Invoice  Recd  Fee VAT St │ │  static synthetic table, hairlines
│  │ 1,250.00 1,209.63 38.45 … │ │
│  └───────────────────────────┘ │
├───────────────────────────────┤
│ RAMZA copilot                  │  ADDED SECTION
│  "Ask why the money is short." │
│  ┌───────────────────────────┐ │
│  │ ▸ Why is this Tamara       │ │  preset Qs; tap to expand trace
│  │   payout SAR 300 short?    │ │
│  │ ▸ Which invoices are still │ │
│  │   unpaid after the payout? │ │
│  │ ▸ What's the VAT on this   │ │
│  │   month's gateway fees?    │ │
│  └───────────────────────────┘ │
├───────────────────────────────┤
│ Integrations                   │
│  Stores:   [Shopify][Woo]      │  text chips, hover shows status
│  Payments: [Stripe][Telr]…     │
│  Books:    [Zoho — Live]       │
│            [Xero — on request] │  → #audit with accounting_tool prefilled
├───────────────────────────────┤
│ Free payout audit   #audit     │  the conversion block
│  copy + NDA line               │
│  ┌───────────────────────────┐ │
│  │ Name                      │ │
│  │ WhatsApp number           │ │
│  │ Work email                │ │
│  │ Store URL                 │ │
│  │ Gateways [chips multi]    │ │
│  │ Monthly orders [select]   │ │
│  │ Accounting tool [select]  │ │
│  │ [ Request my audit ]      │ │
│  └───────────────────────────┘ │
│  → success → "Audit requested" │
│  → inline Cal.com embed        │
├───────────────────────────────┤
│ Founding partners              │
│  copy + [PRICE_SETUP] /        │
│  [PRICE_MONTHLY] placeholders  │
│  [ Get a free payout audit ]   │
├───────────────────────────────┤
│ FAQ (accordion)                │
│  ▸ Do I need to change gateways?│
│  ▸ What about my bank data?     │
│  ▸ We use Xero or QuickBooks    │
│  ▸ We sell in AED and SAR       │
│  ▸ How long does setup take?    │
│  ▸ Is this an app or a service? │
├───────────────────────────────┤
│ RAMZA رمز                      │  footer
│ WhatsApp · email · LEGAL_LINE  │
│ Privacy                        │
└───────────────────────────────┘
```

### Desktop (≥ 1024px)

```
┌──────────────────────────────────────────────────────────────────────┐
│ RAMZA رمز    How it works · Integrations · Pricing   [Get audit] (wa) │
├──────────────────────────────────────────────────────────────────────┤
│                                    │                                 │
│  Every Tabby, Tamara and Telr      │   ┌─────────────────────────┐    │
│  payout, matched to your bank      │   │  HERO RECONCILIATION     │    │
│  and closed in Zoho Books.         │   │  bank credit  [Unmatched]│    │
│                                    │   │  ┌ Tabby payout file ──┐ │    │
│  RAMZA reads your store orders,    │   │  │ 5 rows + "37 more"  │ │    │
│  payout files and bank statement…  │   │  └────────────────────┘ │    │
│                                    │   │  connector ─→ [Matched]  │    │
│  [ Get a free payout audit ]       │   │  [Bank charges chip]     │    │
│  [ Chat on WhatsApp ]             │   │  Zoho: Paid ×42 counter  │    │
│                                    │   └─────────────────────────┘    │
├──────────────────────────────────────────────────────────────────────┤
│  Tabby and Tamara pay net.  │  A refund reopens it.  │ Five gateways… │  pain strip: 3 cols, hairline dividers
├──────────────────────────────────────────────────────────────────────┤
│              Dashboards show you the gap. RAMZA closes it.            │  contrast line, centered-block but text left within measure
├──────────────────────────────────────────────────────────────────────┤
│  How it works                                                        │
│  1 Connect …   2 Send …   3 Match …   4 Close …                       │  4-up
│                                                                      │
│   Order ───── Gateway ───── Payout ───── Bank ───── Books            │  CHAIN DRAW horizontal, draws once
├──────────────────────────────────────────────────────────────────────┤
│  What your accountant sees            │  [ synthetic table ]          │  2-col: copy left, table right
├──────────────────────────────────────────────────────────────────────┤
│  RAMZA copilot                        │  [ chat panel, preset Qs ]    │  2-col
├──────────────────────────────────────────────────────────────────────┤
│  Integrations   Stores · Payments · Books  (three chip rows)          │
├──────────────────────────────────────────────────────────────────────┤
│  Free payout audit                    │  [ form card ]                │  2-col; on success form card → confirm + Cal embed
├──────────────────────────────────────────────────────────────────────┤
│  Founding partners      copy + placeholders + CTA                    │
├──────────────────────────────────────────────────────────────────────┤
│  FAQ         two columns of accordion items                          │
├──────────────────────────────────────────────────────────────────────┤
│  RAMZA رمز    WhatsApp · email · LEGAL_LINE · Privacy                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Component tree

```
app/ramza/page.tsx  (server)
└─ <RamzaShell>                         data-ramza wrapper, fonts, JSON-LD
   ├─ <Nav>                    client   sticky/scroll-collapse, WhatsApp button
   │  └─ <Wordmark>            server   RAMZA + رمز secondary mark
   ├─ <Hero>                   client   layout + copy + ?h= variant resolution
   │  ├─ <CtaButton> ×2        server
   │  └─ <HeroReconciliation>  client   the 3-scenario animation (framer-motion)
   ├─ <PainStrip>              server   3 statements, hairline dividers
   ├─ <ContrastLine>           server
   ├─ <HowItWorks>             server   4 numbered steps
   │  └─ <ChainDraw>           client   IntersectionObserver + SVG stroke draw
   ├─ <AccountantView>         server   copy + static synthetic table
   ├─ <Copilot>               client   canned Q&A, expand-on-click
   ├─ <Integrations>           client   chip groups, hover status, prefill links
   ├─ <AuditForm>              client   form + validation + states + Cal embed + Pixel/CAPI
   ├─ <FoundingPartners>       server   pricing placeholders + CTA
   ├─ <Faq>                    client   accordion, motion on open/close
   └─ <Footer>                 server

app/privacy/page.tsx           server   structured placeholder
app/api/lead/route.ts          server   validate → Supabase → Telegram → Meta CAPI
```

Shared: `<CtaButton>`, `<Chip>`, `<Section>` (consistent vertical rhythm + measure), `<Hairline>`.

---

## File tree (new + modified)

```
app/
  ramza/
    layout.tsx              NEW  scoped <html data-ramza>? no — wrapper div; imports ramza.css; metadata; Meta Pixel <Script>
    page.tsx                NEW  assembles sections; JSON-LD (Organization + FAQPage)
    ramza.css               NEW  scoped tokens (light + dark), .tnum, measure helpers
    opengraph-image.tsx     NEW  1200×630, final matched state + wordmark (ImageResponse)
  privacy/
    page.tsx                NEW  placeholder legal page (also data-ramza)
  api/
    lead/
      route.ts              NEW  POST handler
components/
  ramza/
    nav.tsx                 NEW
    wordmark.tsx            NEW
    hero.tsx                NEW
    hero-reconciliation.tsx NEW
    pain-strip.tsx          NEW
    contrast-line.tsx       NEW
    how-it-works.tsx        NEW
    chain-draw.tsx          NEW
    accountant-view.tsx     NEW
    copilot.tsx             NEW
    integrations.tsx        NEW
    audit-form.tsx          NEW
    founding-partners.tsx   NEW
    faq.tsx                 NEW
    footer.tsx              NEW
    ui/
      cta-button.tsx        NEW
      chip.tsx              NEW
      section.tsx           NEW
lib/
  ramza/
    copy.ts                NEW  all page copy; H1 variants keyed by ?h= ("default" | "money" | "books")
    scenarios.ts           NEW  3 synthetic hero scenarios + arithmetic comments
    attribution.ts         NEW  first-party cookie: utm_*, fbclid→fbc, referrer, landing_path (set on first visit, client)
    meta.ts               NEW  Pixel pageview/Lead helpers (client) + CAPI event POST (server), shared event_id
    leads.ts              NEW  Supabase insert + Telegram notify (server)
    validation.ts         NEW  lead payload zod-free hand validation (matches repo style), specific messages
middleware.ts             MOD  add "/ramza", "/privacy", "/api/lead" to PUBLIC_PATHS
db/schema.sql             MOD  append `leads` table
.env.example             NEW/MOD  document the 9 RAMZA env vars (no values)
README.ramza.md          NEW  env setup, table SQL, Telegram bot setup, H1 variant swap, placeholder list
package.json             MOD  add @calcom/embed-react (only new dep; framer-motion already present)
```

Notes:
- `motion` in the brief == `framer-motion` v12 (already installed `^12.42.2`). Use `framer-motion` imports, no new dep.
- Cal.com: `@calcom/embed-react` for the inline embed (reliable, ~small). Alternative is the raw embed snippet with no dep — will use the package unless you'd rather avoid it.
- Fonts scoped to `/ramza` and `/privacy` via the font className on the wrapper, not `app/layout.tsx` (keeps the omnia app untouched).

---

## Data + integrations

### `leads` table (append to `db/schema.sql`, then `node db/apply-schema.mjs`)

```sql
create table if not exists leads (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  name           text not null,
  whatsapp       text not null,
  email          text not null,
  store_url      text not null default '',
  gateways       text[] not null default '{}',
  monthly_orders text not null default '',   -- '<500' | '500-2000' | '2000-10000' | '10000+'
  accounting_tool text not null default '',  -- 'zoho' | 'xero' | 'quickbooks' | 'excel-none'
  utm_source     text not null default '',
  utm_medium     text not null default '',
  utm_campaign   text not null default '',
  utm_content    text not null default '',
  fbc            text not null default '',
  fbp            text not null default '',
  referrer       text not null default '',
  landing_path   text not null default '',
  event_id       text not null default '',
  source         text not null default 'ramza-landing'
);
create index if not exists leads_created_idx on leads (created_at desc);
```

(The brief's column list had a typo "fbc referrer" — read as two columns `fbc` and `referrer`. Added `fbp` too since Meta CAPI matching wants it.)

### `POST /api/lead`

1. Parse + validate (specific inline messages, e.g. "Add a WhatsApp number with country code").
2. Insert into `leads` (server-role Supabase client, already in `lib/supabase.ts`).
3. `sendTelegramMessage(...)` — reuse `lib/integrations/telegram.ts`. Best-effort, non-blocking.
4. Meta CAPI: POST to `https://graph.facebook.com/v19.0/{NEXT_PUBLIC_META_PIXEL_ID}/events` with `META_CAPI_ACCESS_TOKEN`, `event_name: "Lead"`, the **same `event_id`** the browser sent, `action_source: "website"`, `user_data` hashed (SHA-256) email + phone + `fbc`/`fbp`, `event_source_url`. Best-effort, non-blocking, logged.
5. Return `{ ok: true, event_id }`. Client fires browser Pixel `Lead` with that `event_id` **on success only**.
6. Honeypot field + 24h dedupe on email (same pattern as the numio route).

### Attribution cookie (`lib/ramza/attribution.ts`)

- On first `/ramza` visit (no `ramza_attr` cookie): read `utm_*`, `fbclid` (→ build `fbc` as `fb.1.{ts}.{fbclid}`), `document.referrer`, `location.pathname`. Write a first-party JSON cookie, 90-day, `SameSite=Lax`.
- `<AuditForm>` reads the cookie and includes it in the POST body.
- Meta Pixel sets `_fbp` itself; read it for CAPI.

### Meta Pixel (`app/ramza/layout.tsx`)

- `next/script` `strategy="afterInteractive"`, base pixel code + `PageView`, only in the `/ramza` subtree.
- No pixel on the omnia app.

---

## Hero animation spec (implementation notes)

`components/ramza/hero-reconciliation.tsx`, data from `lib/ramza/scenarios.ts`.

- 3 scenarios: **Tabby** (AED, brief's numbers — 19,033.70 − 584.00 − 29.20 = 18,420.50), **Tamara** (SAR payout with an FX line), **COD courier remittance** (AED, courier deducts COD handling). Each scenario object carries `bankCredit`, `orders[]`, `gross`, `fee`, `vatOnFee`, `fxLine?`, `invoicesClosed`, and a `// arithmetic:` comment proving it foots.
- Timeline per scenario ≈ 7s, via a single `framer-motion` `useAnimate` sequence or an array of keyframed variants driven by a step index on an interval. Transforms + opacity only.
- `document.hidden` (visibilitychange) and `onMouseEnter`/`onMouseLeave` pause the interval.
- `useReducedMotion()` → render scenario 1's final matched state, no interval, no loop.
- Counter count-ups use a `motion` value with `.tnum`.
- Root gets `role="img"` + `aria-label`: "Animation showing a Tabby payout of 42 orders matched to a bank credit of 18,420.50 dirhams, with gateway fees and VAT split out, and 42 Zoho invoices marked paid."
- Target 60fps on mid Android: no `box-shadow` transitions, no `width`/`height` animation, `will-change: transform` only on the moving connector + cards, removed after.

---

## Quality bar checklist (verify before calling it done)

- [ ] 360px first; no horizontal scroll at 320–430px.
- [ ] Lighthouse mobile: performance ≥ 95, accessibility ≥ 95 (run against `next build && next start`).
- [ ] No CLS from fonts (`next/font`, `display: swap`, `adjustFontFallback`).
- [ ] Visible keyboard focus on every interactive element; AA contrast on all token pairings (light + dark).
- [ ] Hero animation holds 60fps in a CPU-throttled profile; pauses on hover + tab hidden; reduced-motion path verified.
- [ ] Chain draw is the only scroll-triggered motion.
- [ ] Form validation messages are specific; success fires Pixel + CAPI once with a shared `event_id`.
- [ ] `/privacy` reachable; footer links correct.
- [ ] `npx tsc --noEmit` clean for new files; `node db/apply-schema.mjs` run.
- [ ] No real client data, no logos, no forbidden claims anywhere in copy.

---

## Task breakdown (build order, Step 2)

1. **Scaffold + tokens.** `app/ramza/{layout,page,ramza.css}`, `RamzaShell`, `Section`/`Chip`/`CtaButton`/`Hairline`, fonts, middleware paths, `.env.example`. Page renders section stubs.
2. **`leads` table + `/api/lead` + attribution + Meta.** Schema, apply, route with validation/dedupe/honeypot, Telegram, CAPI, attribution cookie, Pixel script. Verified with curl + a real row + cleanup.
3. **Nav + Hero (static).** Wordmark, sticky/collapse nav, hero layout, copy from `lib/ramza/copy.ts`, `?h=` variants, CTAs. No animation yet.
4. **Hero reconciliation animation.** `scenarios.ts` (3, arithmetic-commented), the orchestrated sequence, pause/reduced-motion, aria-label.
5. **Pain strip, contrast line, how-it-works + chain draw.** Chain draw = IntersectionObserver + SVG stroke-dashoffset, once.
6. **Accountant view + Copilot.** Static table; canned copilot with 3 preset questions and expand traces.
7. **Integrations + Audit form + Cal.com.** Chip groups w/ hover status, "on request" → prefilled `#audit`; full form, states, inline Cal embed, Pixel/CAPI fire on success.
8. **Founding partners + FAQ + Footer + `/privacy`.** Placeholders wired.
9. **OG image, JSON-LD, polish pass.** `opengraph-image.tsx`, Organization + FAQPage schema, contrast + focus + Lighthouse pass, 360px sweep.
10. **`README.ramza.md`** + the placeholder list.

---

## Placeholders the founder must fill (Deliverable 4)

| Placeholder | Where | Notes |
|---|---|---|
| `[PRICE_SETUP]` | Founding partners | no invented number |
| `[PRICE_MONTHLY]` | Founding partners | |
| `[SETUP_TIME]` | FAQ "How long does setup take?" | |
| `LEGAL_LINE` | Footer | no legal entity name until provided |
| NDA / data-retention wording | Free audit copy + FAQ "bank statement data" | founder to confirm before launch |
| Email-forwarding claim | How it works step 2 | if not live, copy falls back to "Upload them, or we pull them for you" — **need a yes/no** |
| `NEXT_PUBLIC_CAL_LINK` | Cal embed | |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | Nav, hero, footer, FAQ | E.164 |
| `NEXT_PUBLIC_META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN` | Pixel + CAPI | Lead event stays inert until set |

## Open questions before/at build

1. **Email-forwarding to a private RAMZA address — live or not?** Changes How-it-works step 2 copy.
2. **Same Supabase project as omnia?** Plan assumes yes (reuses `lib/supabase.ts`, service-role key already in env). New `leads` table is isolated from omnia tables.
3. **`/privacy` content** — structured placeholder now, real copy later? Plan assumes placeholder.
4. **A/B H1 variants** — brief gives 2 alts + default via `?h=`. Confirm keys: `?h=money` and `?h=books`.
5. **Cal.com embed dep** — OK to add `@calcom/embed-react`, or use the dep-free snippet?
6. Dark mode — brief mandates it. Confirm you want the `/ramza` page to follow the visitor's OS setting (no toggle). Plan assumes yes.
