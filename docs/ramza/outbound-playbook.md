# RAMZA outbound playbook — Apify → Instantly → accounts@ramzaworks.com

Owner: founder · Operator: `outbound-operator` agent · Last updated 2026-10-08

The idea in one line: **find UAE stores whose own checkout shows the pain RAMZA
removes** (Tabby / Tamara / several gateways / COD on Shopify or WooCommerce),
and write to them about *their* stack — not a generic "we do accounting" email.

---

## 1. Who we write to (ICP)

| Tier | Signal on their site | Angle | Volume target |
|---|---|---|---|
| **A** | BNPL (Tabby/Tamara/Postpay) **and** ≥ 2 payment methods (or COD) | "Tabby + Stripe + COD settle on 3 schedules — we match every payout to the bank and book it in Zoho" | all of them |
| **B** | one BNPL, or a store platform (Shopify/Woo/Salla/Zid), or 2+ gateways | Payout reconciliation + e-invoicing readiness | most |
| **C** | website, no store signals | Books catch-up / CT / e-invoicing dates | low priority, later |
| Large (≥ AED 50M revenue) | — | E-invoicing ASP deadline | **manual**, founder writes personally |

Categories that convert for D2C payouts in the UAE: abaya & modest fashion,
perfume & oud, jewellery & accessories, cosmetics, kids, home & décor,
electronics accessories, supplements, gifting & flowers, sneakers.

## 2. Sending setup (protects ramzaworks.com)

**Never send cold email from `ramzaworks.com`.** It carries your invoices and
client mail; one spam-trap hit and they all land in spam.

1. Buy 2–3 lookalike domains (e.g. `ramzaworks.co`, `getramzaworks.com`,
   `ramzaworks-mail.com`). Each one 301-redirects to ramzaworks.com.
2. 2 inboxes per domain (Google Workspace or Zoho Mail), real names, same
   signature: name · RAMZA · ramzaworks.com · WhatsApp.
3. SPF, DKIM, DMARC (`p=none` to start) on every domain; custom tracking domain
   in Instantly.
4. Warm up in Instantly for **3 weeks** before the first campaign.
5. Cap **30 sends / inbox / day** → 6 inboxes ≈ 180/day ≈ 3,600/month.
6. **Reply-to = accounts@ramzaworks.com.** Instantly's unibox forwards every
   reply there, so the conversation moves onto the real domain from the first
   human reply.

## 3. The pipeline (all runnable today)

```
Google Maps (Apify)  ─┐
Shopify store finder ─┼─► dedupe by domain ─► homepage + contact page scan
Instagram profiles   ─┘                         (gateways, platform, COD, email)
                                                    │
                                    score A/B/C ◄───┘
                                         │
                       Instantly CSV ◄───┘  (custom vars: gateways, platform, segment)
```

**Script:** `scripts/ramza/prospects.ts`

```bash
npx tsx --env-file=.env.local scripts/ramza/prospects.ts \
  --queries "abaya online store,perfume shop,jewellery store,cosmetics online store" \
  --location "Dubai, United Arab Emirates" --per-query 100 --instagram
# → ~/Downloads/ramza-prospects-YYYY-MM-DD.csv
```

Repeat with `--location "Sharjah, United Arab Emirates"`, `"Abu Dhabi, …"`,
and later `"Riyadh, Saudi Arabia"` (KSA Tabby/Tamara stores, same pain).

| Step | Apify actor | Cost (approx.) | What we keep |
|---|---|---|---|
| Discover | `compass/crawler-google-places` (with website, open, contacts) | ~ USD 4–8 / 1,000 places | name, website, phone, Maps listing, socials, emails the business publishes |
| Store finder (optional) | `clearpath/shopify-store-leads` | per result | Shopify stores with `.ae` / UAE address |
| Instagram | `apify/instagram-profile-scraper` on **the business's own handle** | ~ USD 2–3 / 1,000 | followers, business category, public business email |
| Decision-maker (optional, A tier only) | `harvestapi/linkedin-company-employees` | per result | founder / finance-lead name + title (no scraping of personal emails) |
| Signals | our own fetch (free) | 0 | Tabby/Tamara/Postpay/Stripe/Telr/Checkout/Network, Shopify/Woo/Salla/Zid/Magento, COD |

Tested 2026-10-08 on live data: 10 Dubai perfume stores → 7 with a business
email, 3 tier A (Tabby + Shopify/COD detected from their checkout code).

**Budget:** the free Apify plan (USD 5/month, 5 concurrent runs) is enough for
testing only. The Starter plan (~USD 39–49/month) covers ~5,000 enriched stores
a month. Check `apify.com/pricing` before upgrading — prices change.

**Verification:** run the CSV through Instantly's built-in verifier (or
MillionVerifier) and drop anything not "valid". Freemail addresses
(`email_type=freemail`) only when the shop itself publishes them as its contact.

## 4. Sequences (plain text, 4 touches, one link)

Every number comes from `config/rules.json` (written below as `{{…}}`), never
typed into Instantly by hand. No FTA/MoF logos or "official" tone. RAMZA is not a
tax agent and not an ASP — say "our licensed filing partner" / "an accredited
provider".

**Segment ecommerce — tier A** (custom vars from the CSV)

> **Subject:** {{gateways}} payouts → Zoho
>
> Hi {{firstName|there}},
>
> Saw {{company}} takes {{gateways}} on {{platform}}. Each of those pays out on
> its own schedule, net of its own fees — so the deposit in the bank never
> equals the orders behind it.
>
> RAMZA matches every payout to its orders and the bank credit, splits out the
> fee and VAT, and books it in Zoho — an accountant signs off before anything posts.
>
> Worth a free check on one month of your payouts? I'll send back the list of
> anything short-paid, missing or booked twice.
>
> — {{sender}}, RAMZA

**Touch 2 (day 3):** one line + the free reconciliation check link with UTM
`utm_source=instantly&utm_campaign=recon_a&utm_content=t2`.

**Touch 3 (day 7) — e-invoicing hook:** "UAE B2B invoices move to structured
e-invoicing; businesses above {{EINV.largeRevenueAed}} appoint a provider by
{{EINV.largeAspBy}}. Clean payout data is the part that makes the switch easy."
(Link: the e-invoicing checker on the home page.)

**Touch 4 (day 14):** break-up — "Shall I close the file? Reply 'later' and
I'll check back after month-end."

**Segment smb / C:** books catch-up + CT (rescue copy only inside the rules.json
rescue window, `rulesMode() === "rescue"`).

Copy is written by the `conversion-copywriter` agent and checked by
`compliance-gate` before the campaign starts.

## 5. Instagram — warm, manual, not automated

Automated DMs get business accounts banned and break Instagram's terms, so the
scraper only *reads* public business profiles. The DM is human:

- From the RAMZA Instagram, after email touch 2, to tier A only, ≤ 20/day.
- Engage first (like 2 recent posts), then: "Hi — sent a note to your accounts
  inbox about matching your {{gateways}} payouts to Zoho. Happy to run it on a
  month for free if useful."

## 6. Replies → leads → WhatsApp

- Reply in Instantly unibox → forwarded to accounts@ramzaworks.com.
- Positive reply: create the lead through the existing pipeline
  (`app/api/lead` → `lib/ramza/leads.ts` → Supabase `leads` with
  `source = 'outbound'`, Telegram alert), then move to WhatsApp.
- "Not interested" / unsubscribe → Instantly blocklist the **domain**, and add
  to the suppression list the tracking-engineer syncs.

## 7. Compliance guardrails

- **Data:** only contact details the business itself publishes (website, Maps,
  business profile). No personal social accounts, no bought lists, no guessed
  personal emails. Keep the source URL per row (the `maps` / `website` columns).
- **UAE PDPL** (Federal Decree-Law 45/2021): B2B contact at a role address, a
  clear sender identity, an opt-out line in every email, honour it within 24 h,
  delete on request.
- **Platform terms:** Apify actors read public pages only; no logging in to
  Instagram/LinkedIn accounts to scrape.
- **Claims:** no "your company is late / facing penalties"; we *estimate*,
  we can't see anyone's FTA account.

## 8. Weekly rhythm & targets

| Day | Do |
|---|---|
| Mon | Pull 500 new prospects (2–3 queries × 2 cities), verify, load A+B into Instantly |
| Tue–Thu | Founder answers replies within 2 h; WhatsApp calls |
| Fri | Review: sent, open, **reply %**, positive replies, calls booked; kill the worst subject line |

Healthy numbers for plain-text B2B in the UAE: reply rate 3–6 %, positive
replies ~1 % of sent. At 180/day that is ~1–2 calls a day once warm.

## 9. Open items for the founder

1. Buy the 2–3 sending domains and create 6 inboxes (or approve and I'll list
   exact steps for Zoho Mail).
2. Instantly account + API key → `.env.local` as `INSTANTLY_API_KEY` (then the
   script can push leads straight into a campaign instead of a CSV).
3. Decide the Apify plan (free credit is ~USD 2.80 left this month).
4. Rotate the Apify token that was pasted in chat on 2026-10-08.
