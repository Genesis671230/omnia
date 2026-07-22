# Founder Dashboard Overhaul — Design

**Date:** 2026-07-22
**Status:** Approved (verbal, session)
**Phase:** 1 of 5 (dashboard visual overhaul + insight engine). Later phases: campaign intelligence, orders workflow, employee performance, agent monitoring / sales boost.

## Problem

Founders find the current dashboard (`components/finance/founder-dashboard.tsx`) too technical and text-heavy. It reports numbers but surfaces no insights, no actions, and no campaign visibility (which campaigns run/paused, how creatives perform, what to improve).

## Decisions (locked with user)

1. **Build order:** dashboard overhaul first; campaign/team sections designed as slots for later phases.
2. **Insights:** hybrid — deterministic rules detect facts; one AI pass (Haiku, existing Anthropic plumbing) phrases headline/why/recommendation. AI never supplies numbers; client renders figures from structured fact fields. Graceful degradation to rule templates if AI fails.
3. **Visual:** vivid glass/gradient redesign — gradient hero band, glassy cards, colorful recharts charts, product imagery, animated deltas (framer-motion).
4. **Insight actions:** drill-in drawer + "Assign task" (writes to a new minimal `tasks` table). No external write-backs (no Meta pause/resume) in this phase — consistent with read-only AI guardrails.

## Architecture

**Approach:** new visual layer on the existing data spine. Fresh components consume the existing `/api/dashboard` payload plus a new `/api/insights` endpoint. Old `founder-dashboard.tsx` is replaced when complete. Data plumbing untouched.

### Page layout (top → bottom)

1. **Gradient hero band** — indigo→violet gradient; glass cards: Revenue (count-up + % delta vs prior period), Cash into bank, Awaiting payout, COD outstanding. Sparklines + plain-English captions. Period + store filter pills.
2. **Insight rail** — 3–6 AI insight cards: severity edge, icon, headline, why-it-matters, buttons **View** (drawer) and **Assign task**.
3. **Chart grid** (recharts, entrance animations): stacked daily revenue area chart (gradient fills per store), gateway share donut, store comparison bars, top products as image-led carousel.
4. **Live pulse strip** — new-order ticker with product thumbnails.
5. Every number clickable → dialog/drawer with breakdown. No dead text.

### Insight engine

- `lib/insights/rules.ts`: pure detectors → typed `InsightFact[]`:
  - campaign paused with recent spend
  - ROAS drop vs prior window (alias-safe Meta account mapping)
  - COD receivables aging beyond threshold
  - awaiting-payout spike
  - best-seller trending out of stock
  - unresolved exceptions
- `/api/insights`: runs rules over dashboard + ads data, one Haiku call for phrasing/prioritization, result cached in `insights` table (refresh ≤ every 30 min or manual).

### Drawers & dialogs

- **Campaign drawer**: extends existing `CampaignDrawer.tsx` — status, spend/ROAS/CTR trends, creative thumbnails with per-creative performance, AI recommendation block.
- **Money drawers**: breakdown tables + mini-charts behind each hero number.
- **Assign task dialog**: minimal `tasks` table (title, detail, source insight, assignee, status, created_at); createPortal per established modal pattern. Phase-4 employee module builds on this table.

### Error handling & testing

- Per-section degradation (failed insights never blanks charts); skeleton shimmer while loading.
- Unit tests for every rule detector (pure functions); schema test for insights API response.
- Schema changes via `db/schema.sql` + `node db/apply-schema.mjs`.

## Out of scope (phases 2–5)

Campaign write-backs to Meta, employee performance module, orders multi-select/invoice UX, agent monitoring panel, sales-boost engine.
