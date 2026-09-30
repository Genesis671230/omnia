## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
- Books closing / reconciliation / Zoho booking / payout exceptions → skill omnia-books-closing; for a whole close or a stuck order, delegate to the omnia-books-specialist agent (.claude/agents/). Future finance agents: .agents/skills/omnia-os/references/agent-roster.md
- RAMZA deadline/rescue campaign (CT filing page, calculators, Meta ads, cold email, tracking) → the RAMZA agents in .claude/agents/ (compliance-gate, conversion-copywriter, landing-builder, tracking-engineer, meta-ads-operator, outbound-operator); brief below

## RAMZA — Deadline Rescue Campaign

Mission: capture UAE SMB + e-commerce leads around the CT filing deadline (30 Sep 2026) and the
post-deadline "late filer rescue" window (1 Oct – 31 Oct), then convert to monthly AI accounting.

### Hard rules (every agent)
- Single source of truth for dates/penalties/pricing: `config/rules.json`, read in code only through `lib/ramza/rules.ts` (`CT`, `rulesMode`, `priceForTxn`, `billableTxn`). Never hardcode numbers in copy or code.
- RAMZA is NOT a registered tax agent and NOT an FTA-accredited ASP. Filing is done via licensed partner. Never claim otherwise.
- No FTA / EmaraTax / MoF logos, colours, or "official" framing. No "check your FTA account" claims — we ESTIMATE penalties, we can't see their account.
- Meta policy: never assert personal attributes ("Are YOU facing penalties?", "Your company is late"). Use "UAE businesses with Dec year-end…".
- Pricing values that are `null` in rules.json are undecided: show "Get a quote", never invent a number.
- The late-registration waiver needs the first return filed within 7 months of the first period end — for Dec-2025 year-ends that closed 31 Jul 2026. Don't pitch it to that audience.
- Ship over polish. One landing page, one form, one offer per audience.

### Agent pipeline
1. `compliance-gate` → verifies rules.json against FTA/MoF sources; reviews every claim before ship
2. `conversion-copywriter` → page copy + ad copy + email copy, all reading from rules.json
3. `landing-builder` → Next.js page + 3 tools (deadline checker, penalty estimator, transaction pricing counter)
4. `tracking-engineer` → Meta Pixel + CAPI, UTMs, lead webhook → CRM + WhatsApp + Instantly
5. `meta-ads-operator` → campaign structure, creatives, budgets, policy lint
6. `outbound-operator` → Instantly sequences on DED licence data

Order: 1 → (2 ∥ 3) → 4 → 1 (claims review) → (5 ∥ 6)

### What already exists in this repo (extend it — don't rebuild)
- Pages: `app/ramza/*` (home, penalty-checker, corporate-tax-penalties, late-registration-waiver, reconsideration, services, contact, payout-reconciliation, `[...slug]` content pages); CT components in `components/ramza/ct/*`.
- Penalty logic: `lib/ramza/ct-penalty.ts` (pure, tested in `tests/ramza/ct-penalty.test.ts`) — already reads amounts/windows from rules.json. Countdown: `nextDecYearEndDeadline` there.
- Tracking: `lib/ramza/track.ts` (browser: Meta/TikTok/GTM/Google Ads, one `track()` call) + `lib/ramza/meta.ts` (server CAPI, SHA-256, shared event_id dedup) + `lib/ramza/attribution.ts` (UTMs/fbc/fbp).
- Leads: `app/api/lead/*` → `lib/ramza/leads.ts` → Supabase `leads` / `pilot_leads` tables + Telegram alert (`lib/integrations/telegram`). Validation in `lib/ramza/validation.ts`. Add new lead fields as schema columns (`db/schema.sql`, then `node db/apply-schema.mjs`).
- Known debt for compliance-gate: ~35 marketing strings in `components/ramza/ct/*` and `app/ramza/*` still hardcode AED 500 / 1,000 / 10,000, 7 months, 14% — move them to `CT.*` and review the waiver framing for the rescue window.
