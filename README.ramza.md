# RAMZA landing page

A single conversion-focused page for RAMZA (payout reconciliation for Gulf
e-commerce), living inside this repo at:

- `/ramza` — the landing page
- `/privacy` — placeholder privacy page
- `POST /api/lead` — audit-request intake

Built to the brief in `docs/superpowers/plans/2026-09-10-ramza-landing-page.md`.
All demo data is synthetic. No client names, logos, or real amounts anywhere.

## Environment

The app already provides `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. RAMZA adds the vars in
`.env.ramza.example`:

| Var | Purpose | Behaviour if unset |
|---|---|---|
| `NEXT_PUBLIC_META_PIXEL_ID` | Meta Pixel + CAPI | Pixel not injected, `Lead` event inert, leads still saved |
| `META_CAPI_ACCESS_TOKEN` | Meta Conversions API | CAPI call skipped |
| `NEXT_PUBLIC_CAL_LINK` | Cal.com booking (e.g. `ramza/audit-walkthrough`) | Success screen shows "we'll WhatsApp you to book" |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | WhatsApp CTA (E.164, `+` and spaces are stripped) | WhatsApp buttons point at `#audit` |
| `NEXT_PUBLIC_RAMZA_EMAIL` | Footer contact email | falls back to `hello@ramza.example` |
| `LEGAL_LINE` | Footer legal line | renders the literal `LEGAL_LINE` placeholder |

## Database

`leads` is defined in `db/schema.sql`. Apply it the same way as the rest of the
schema:

```bash
node db/apply-schema.mjs
```

Standalone SQL (if you ever lift RAMZA into its own project):

```sql
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  name            text not null,
  whatsapp        text not null,
  email           text not null,
  store_url       text not null default '',
  gateways        text[] not null default '{}',
  monthly_orders  text not null default '',
  accounting_tool text not null default '',
  utm_source      text not null default '',
  utm_medium      text not null default '',
  utm_campaign    text not null default '',
  utm_content     text not null default '',
  fbc             text not null default '',
  fbp             text not null default '',
  referrer        text not null default '',
  landing_path    text not null default '',
  event_id        text not null default '',
  status          text not null default 'new',
  user_agent      text not null default '',
  source          text not null default 'ramza-landing'
);
create index if not exists leads_created_idx on leads (created_at desc);
create index if not exists leads_status_idx on leads (status);
```

## Telegram

Reuses `lib/integrations/telegram.ts`. On a successful lead the founder gets a
message in the group named by `TELEGRAM_CHAT_ID`. To set up a fresh bot:

1. Talk to `@BotFather`, `/newbot`, copy the token into `TELEGRAM_BOT_TOKEN`.
2. Add the bot to your group, send any message there.
3. `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` and read
   `result[].message.chat.id` (a negative number for groups) into
   `TELEGRAM_CHAT_ID`.

## Meta Pixel + Conversions API

- The browser Pixel fires `PageView` on load and `Lead` **only on a successful
  form submit**, with an `eventID`.
- `POST /api/lead` fires the server-side `Lead` via the Conversions API with the
  **same `event_id`**, so Meta dedupes the two.
- Ad attribution (`utm_*`, `fbclid` → `fbc`, `referrer`, `landing_path`) is
  captured into a first-party `ramza_attr` cookie on the first visit
  (`lib/ramza/attribution.ts`) and attached to the lead row.

## Swapping the H1 (A/B)

`lib/ramza/copy.ts` → `H1_VARIANTS`. Three keys:

| URL | H1 |
|---|---|
| `/ramza` | Every Tabby, Tamara and Telr payout, matched to your bank and closed in Zoho Books. |
| `/ramza?h=money` | Find the money your payment gateways didn't send. |
| `/ramza?h=books` | Your gateways pay out. RAMZA closes the books. |

Point each ad variant at the matching URL. Add or edit variants in
`H1_VARIANTS` and they are picked up by `?h=<key>` with no other change.

## Hero animation

`components/ramza/hero-reconciliation.tsx`, data in `lib/ramza/scenarios.ts`
(three scenarios: Tabby AED, Tamara SAR + FX, COD courier — each foots exactly,
arithmetic in comments). Pauses on hover and when the tab is hidden.
`prefers-reduced-motion` renders scenario 1's final matched state with no loop.

## Design system (2026-09-10 reskin)

LiveFlow-style blue, glass surfaces, dotted-grid fields. All tokens scoped under
`[data-ramza]` in `app/ramza/ramza.css`:

- `--brand #2f6bff` (was a green `--ledger`; `--ledger` is kept as an alias → blue)
- `--paper` white / `--field` pale blue / `--ink` deep navy, dark-mode variants under
  `prefers-color-scheme: dark`
- `.r-glass` — translucent card + `backdrop-filter: blur` + soft shadow, with a
  `@supports` fallback to a near-solid fill
- `.r-dotgrid`, `.r-halo` — the backdrop texture; `components/ramza/backdrop.tsx`
  renders the fixed gradient + grid + halos behind everything

## Motion

- **Hero reconciliation** (`hero-reconciliation.tsx`) and the **scroll-draw chain**
  (`chain-draw.tsx`) — orchestrated loops / one-shot.
- **`reveal.tsx`** — a subtle in-view reveal (opacity + small rise + blur lift, fires
  once) used on section cards. Reduced-motion renders a plain div.
- **Orchestrator** connectors draw dashed with a travelling pulse (`@keyframes r-pulse`).
- FAQ / copilot animate on open/close only.
- **Hero background video** (`hero-bg.mp4`, 1 MB, silent) plays on desktop only;
  phones and reduced-motion get `hero-poster.jpg`. This protects mobile Lighthouse
  (the "balance" decision).

## Placeholders for the founder

| Placeholder | File / location | Notes |
|---|---|---|
| `[PRICE_SETUP]` | `components/ramza/founding-partners.tsx` | no invented number |
| `[PRICE_MONTHLY]` | same | |
| `[SETUP_TIME]` | `lib/ramza/copy.ts` → `FAQ` "How long does setup take?" | |
| `LEGAL_LINE` | `LEGAL_LINE` env / footer | no legal entity name until provided |
| Data-retention wording | `lib/ramza/copy.ts` FAQ "bank statement data"; `app/privacy/page.tsx` "Retention" | confirm before launch |
| Email-forwarding claim | `lib/ramza/copy.ts` → `EMAIL_FORWARDING_LIVE` | currently `false`; flip to `true` only when the private forwarding address is live, and step 2 copy switches automatically |
| `NEXT_PUBLIC_CAL_LINK` | env | Cal.com slug |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | env | E.164 |
| `NEXT_PUBLIC_META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN` | env | until set, tracking is inert |
| OG image | `app/ramza/opengraph-image.tsx` | dynamic via `next/og`; verify `/ramza/opengraph-image` returns a PNG on the deployed environment |
| Intro / hero video | `public/ramza/intro.mp4` (5 MB, click-to-play), `public/ramza/hero-bg.mp4` (1 MB, desktop loop) | compressed from your `rama-intro.mp4` (git-ignored). Replace with a final cut when ready; keep hero-bg silent and short. Or move both to Vercel Blob / a CDN — one string change per file. |
| Testimonials / client proof | not present by design | the original brief forbids them; do not add real ones without written permission |

## Quality bar (verify on a healthy environment — none of this was measurable here)

- Mobile-first, test 360px first.
- **Lighthouse:** the reskin (glass `backdrop-filter`, framer-motion, halos) costs
  performance. Mobile is protected by shipping the poster instead of the hero video
  and lighter motion, but the target of ≥ 95 on mobile is now at risk — measure with
  `next build && next start` and, if it's low, the first levers are: reduce halo
  blur radius, drop `backdrop-filter` on below-the-fold cards, gate `Reveal` behind
  `content-visibility`.
- No CLS from fonts (`next/font`, `display: swap`, `adjustFontFallback`).
- Visible keyboard focus, AA contrast on all token pairings — recheck blue-on-glass
  and `--ink-60` on `--field` in both light and dark.
- Hero + orchestrator + posting animations hold 60fps on a mid-range Android;
  all pause when the tab is hidden; reduced-motion paths render static end states.
- The dev server used during the build was CPU-pegged and the Chrome preview bridge
  was unavailable, so the visual result is unverified. Run it and eyeball it.
