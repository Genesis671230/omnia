# Accounting platform focus — what to keep, cut, and build next

*Written 2026-10-02 from the state of branch `recon-gateway-hardening`. For a new branch that goes deep on accounting.*

## The product in one line

**Close the books for a UAE / Gulf SMB or e-commerce brand from what actually reached the bank — every number traceable to a bank line, a gateway payout or a Zoho document — with a person approving every write.**

Omnia (OmniaStores + House of Omnia) is customer zero. Everything that doesn't move a figure into, or prove a figure in, the books is out of scope for this branch.

## What we already have that is genuinely accounting (keep and harden)

| Module | Where | State |
|---|---|---|
| Bank statements per account (SIB, RAK, cards), dedupe, any CSV/PDF/XLS | `lib/parsers/bank*.ts`, `lib/finance/statement-accounts.ts`, `/api/upload/bank` | Works; credit-card account unset; card statement format unseen |
| Bank line → Zoho posting with guardrails (explicit click, type from account, delete/uncategorise/unmatch, audit) | `components/finance/reconciliation/bank-*`, `/api/integrations/zoho/post-bank-lines`, `lib/finance/zoho-entry-delete.ts` | Works; group/bank-charges panels only know Omniastores' books |
| "Is it already in Zoho?" ledger matching (ref + amount; lookalikes only flagged) | `lib/reconciliation/zoho-ledger-*.ts` | Works |
| Gateway payouts → clearing → bank (Stripe, Telr, Tabby, Tamara, Checkout, Shopify Payments, COD vouchers) | `lib/payout-sync.ts`, `lib/parsers/payouts.ts`, `/api/settlements/*`, recon table | Core strength |
| Fees, VAT on fees, FX differences, refunds with returned fees | `gateway_fee_vat_fx_booking`, `refund_charges_booking` (memory), `/api/integrations/zoho/post-*` | Works, Omniastores-specific account ids in places |
| Sales ledger (what counts as a sale, Dubai days, COD with vouchers) | `lib/orders/sale-rule.ts`, `lib/orders/sales-ledger*.ts` | The one sales truth — dashboard reads it |
| AP: supplier payments, advances on quotations, apply-later, create supplier | `lib/integrations/zoho-vendors.ts`, supplier dialog | Works for Omniastores; House of Omnia token lacks scopes |
| Month check: store sales vs Zoho SOs / invoices / credit notes | `lib/finance/zoho-sales-verify.ts`, `/api/finance/zoho-sales-verify` | Works; found double-invoiced exchanges |
| Three-way: store vs Zoho invoices vs dispatch sheet | `lib/dispatch/*`, `/dispatch` | Works; reads per-month sheets |
| Zoho multi-org, throttle, ledger snapshot | `lib/integrations/zoho-*` | Works |
| Books-closing skill + specialist agent | `.claude/skills/omnia-books-closing`, `.claude/agents/omnia-books-specialist` | Playbook for exceptions |

## What to cut or freeze in the accounting branch

Not deleted from `master` — just not carried, not maintained, not in the nav. Roughly 12k lines of UI and 30 routes that don't touch the books.

| Module | Where | Why out |
|---|---|---|
| Marketing / ads explorer / AI ads analyst / command-centre marketing view | `components/finance/ads`, `marketing-panel.tsx`, `CampaignDrawer.tsx`, `/api/ads/*`, `lib/ai/ads-analyst.ts`, `dashboard-v2/command` (marketing variant, top ads, funnel) | Growth tooling, not accounting |
| Storefronts (leaks, AI roast, preview proxy) | `components/finance/storefront`, `/api/storefront/*`, `lib/storefront` | Same |
| Inventory / warehouse / margin panels | `inventory-panel.tsx`, `warehouse-panel.tsx`, `margin-panel.tsx`, `/api/inventory*`, `/api/margin` | Only stock *valuation* matters to accounting — rebuild later as COGS, not as ops tooling |
| Shipping (SMSA AWB, ship modal), fulfilment spine | `/api/smsa`, `ship-modal.tsx`, `fulfillment-spine.tsx` | Ops |
| Customers panel, AI store chat, pulse, insights rail, telegram listener | `customers-panel.tsx`, `store-chat.tsx`, `/api/chat`, `/api/pulse`, `/api/insights`, `lib/telegram` | Nice-to-have; not books |
| RAMZA marketing site + free tax tools | `app/ramza`, `components/ramza`, `lib/ramza` | Belongs in its own repo / app; keep the CT/VAT rules engine (`lib/ramza/tax-tools.ts`, `config/rules.json`) because the accounting product will reuse it for VAT/CT prep |
| Dashboard flourishes (geo map, courier lanes, greeting banner) | `dashboard-v2/overview/geo-sales.tsx`, `command/cards.tsx` | Replace with an accounting close dashboard (below) |

Keep: orders sync + sales ledger (it is the revenue sub-ledger), dispatch three-way (it is the COD / delivery evidence), payments sheet readers (ops' record of payment status).

## What to build — accounting features, in order

### 1. One ledger model under everything (foundation)
Today every module talks to Zoho directly with its own rules. Introduce an internal **posting journal**: every proposed entry (bank line, payout, fee, refund, supplier payment, FX) is first a row `proposed → approved → posted → verified`, with source document links (bank line, payout, order, invoice) and the Zoho id once posted. Zoho stays the general ledger; this journal is the audit trail, the undo stack and the "what's pending" queue.
- One table (`journal_entries` + `journal_lines`), one posting service with org + account resolution per client.
- All existing post routes become thin wrappers. Explicit-click rule enforced in one place.

### 2. Per-client rules instead of Omnia constants
Account ids (SIB `2330082000000236001`, Credit Card XXX-8436, clearing per gateway), payee rules ("Omnia Mohamed TOF → card"), store codes (~42 files) become **rules data** per client: account map, payee → account rules, gateway → clearing, VAT treatment per expense type. A settings screen to edit them. This is what makes client #2 possible.

### 3. Month-end close as a guided workflow
A close page per month and org with a checklist that is computed, not ticked:
- every bank line booked or explained (per statement account)
- every gateway clearing account at zero or explained (payouts vs bank)
- store sales = Zoho invoices (the month check), exchanges not double-counted, refunds booked as credit notes
- dispatch three-way clean (COD delivered = COD vouchers)
- supplier advances matched to bills
- FX revaluation entries
- VAT for the period computed
- lock: once closed, no posting into the period without reopening (logged)

### 4. AP depth
Bill capture from email / upload (OCR → draft bill), supplier statements reconciliation, recurring bills, credit-card statement → expenses with receipts, payment runs (which bills to pay this week), supplier ageing.

### 5. AR depth
Customer payments applied automatically from payouts (exists for gateways) plus bank transfers by reference; ageing; refunds and credit notes from store refunds; exchange handling that never creates a second sale (the Sep finding: 19 exchanges re-invoiced).

### 6. VAT & Corporate Tax prep (reuses `config/rules.json`)
VAT 201 working paper from the ledger (output VAT by emirate, input VAT, reverse charge on imports — the `intl_goods_rcm` group already exists); CT computation pack (accounting profit → adjustments → taxable income, SBR check). E-invoicing readiness as structured invoice data out of Zoho — not becoming an ASP.

### 7. Reports that come from the books
P&L, balance sheet, cash flow by month and org (from Zoho reports API + the journal), gateway fee analysis, cash conversion (order → payout → bank days). Plus the **time and money saved** cards: lines auto-matched × minutes, duplicates/double invoices caught, penalties avoided, fees recovered — each figure a link to its rows.

### 8. Controls & multi-user
Roles (founder, accountant, ops), approval thresholds, who can delete/uncategorise, full audit log (exists for deletions only), period locks.

## Suggested first week on the new branch
1. Branch from `recon-gateway-hardening` after committing it; remove the frozen modules from the nav and the build (not from git history).
2. Fix the TypeScript baseline: `lib/inventory/apply-event.ts` has a syntax error that makes `tsc` skip type checking; ~120 real type errors sit behind it.
3. Build `journal_entries` + the posting service; route `post-bank-lines` through it first.
4. Move SIB / card / clearing account ids and payee rules into a `client_rules` table with a settings screen.
5. Close page v1 for September 2026 using the checks that already exist (month check, three-way, clearing balances, unbooked bank lines).

## Known data facts to carry over
- Dispatch data is one spreadsheet per month (`payment_sheet_months`); the env sheet is only intake.
- Zoho ignores `vendor_id` on `/bills`, `search_text` on `/contacts`, and **drops date filters when `filter_by=Status.All` is sent** — always filter in code.
- Exchanges are booked as zero-value credit notes plus a new full invoice → Zoho overstates sales; the accounting product must fix this at the source.
- House of Omnia's Zoho token needs `ZohoBooks.fullaccess.all`; `.env.local` had duplicate Zoho keys.
