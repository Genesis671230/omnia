# Agent workforce: Reviewer, 13 engine agents, LinkedIn growth agents

Date: 2026-10-10 · Owner: founder · Status: plan, nothing built yet

## Goal

Turn the finance engine into a team of agents that:

1. run inside the app, so every client copy gets them (not only in Claude Code),
2. know nothing about Omnia except what a **company profile** tells them,
3. never write to a ledger without a Reviewer pass and a human approval,
4. get better as models and parsing get better, with evals deciding when an upgrade ships.

Plus two growth agents that post on LinkedIn daily and find companies that already
show the problems we solve.

## Today, honestly

- The app has the engines (reconciler, posting, parsers, schedulers, exports) and a
  read-only AI tool layer (`lib/ai/tools.ts`).
- Agents exist only as Claude Code subagents (`.claude/agents/`). They run on the
  founder's laptop, not in a client deployment.
- `omnia-books-specialist` hardcodes Omnia's Zoho org, banks and gateways in its prompt.
  It can't be handed to another company as-is.
- Tenancy: one tenant per deployment (`lib/tenant.ts`, `docs/new-client-deployment.md`).
  Connectors are already generic (`lib/connectors/*`: Zoho, Shopify, Gmail).
- Only Zoho Books is supported as the ledger. "Every company" means every Zoho Books
  company for now; QuickBooks/Xero need a ledger connector later.

## Architecture

```
            scheduler (instrumentation.ts) / events / founder request
                                │
                        Agent runtime (lib/agents)
       ┌────────────────────────┼─────────────────────────┐
  registry (data)        company profile            tool layer
  role, model,           Zoho orgs, banks,          read tools (all agents)
  owns, reads,           gateways, clearing         propose tools (write to
  escalation,            accounts, VAT, FY,         agent_plans only)
  autonomy per task      approvers, tone            NO ledger write tools
                                │
          maker agent ──► agent_plans ──► Reviewer ──► human approval
                                                         │
                                       existing engine endpoints post to Zoho
                                                         │
                                               read back ► verified / flag
```

### Pieces

| Piece | Where | Notes |
|---|---|---|
| Company profile | `company_profile` table (jsonb, one row per tenant) + editor in Settings | Everything Omnia-specific moves here: Zoho org ids, bank accounts and their statement hints, gateway → clearing account map, VAT rate and treatment, base currency, fiscal year, approvers, Telegram chat. Generated into each agent's system prompt. |
| Registry | `lib/agents/registry.ts` | One entry per agent: `id, role, model, schedule, reads[], proposes[], owns[] (doc types), escalate(), autonomy{taskType: level}`. Data, not prompts, so a client copy can switch agents on/off. |
| Runtime | `lib/agents/runtime.ts` | Claude API tool loop. Logs every run to `agent_runs` (input, tool calls, tokens, cost, outcome). Model per agent from the registry. |
| Tools | `lib/agents/tools/*` | Read tools reuse `lib/ai/tools.ts` + repositories. Propose tools insert into `agent_plans`. Posting stays in today's engine endpoints, triggered only by an approval. |
| Plans | `agent_plans` table | `id, tenant_id, agent, task_type, period, lines jsonb (doc type, account, amount, currency, evidence refs: bank line id, payout id, order no), totals, status draft → reviewed / blocked → approved → posted → verified / failed`. |
| Flags | `agent_flags` table | The inbox. Both numbers, the evidence, the action needed, who owns it. Controller rolls these into the founder report later. |
| Autonomy | `agent_autonomy` table | Per tenant × agent × task type: `propose_only` (default) / `auto_after_review` / `auto`. Raised by a person, never by an agent. |
| Evals | `evals/agents/<agent>/*.json` + `npm run eval:agents` | Fixtures from real incidents plus synthetic companies. Gate for prompt, model and engine changes. |

### Models

Defaults (registry can override per client):
- Reviewer, books close, intercompany: `claude-opus-5-5`
- Routine agents (sync, data quality, reports, calendar): `claude-sonnet-5-5`
- High-volume classification inside parsing: `claude-haiku-5-5`

A model upgrade is a registry change that ships only when that agent's evals pass.
That is how the system gets stronger as models do, without surprises.

### Parsing gets stronger over time

Document intake works in layers:
1. Known format → deterministic parser (`lib/parsers/*`).
2. Unknown format → Claude extracts into the same canonical schema (statement header,
   lines, opening/closing balance).
3. Every result must **foot**: opening + lines = closing, line count, dates in period.
   A result that doesn't foot becomes a flag, never data.
4. A new format that an LLM parsed and a person confirmed becomes a fixture, then a
   deterministic parser if it repeats.

New clients bring new banks and gateways. Layer 2 handles them on day one; layers 3–4
keep it safe.

## Phase 0: foundation (first)

- `company_profile` table + Settings editor; seed Omnia's profile from what's in the
  agent prompt, env and `zoho_connections` today.
- `agent_runs`, `agent_plans`, `agent_flags`, `agent_autonomy` tables in `db/schema.sql`,
  applied with `node db/apply-schema.mjs`.
- `lib/agents/{registry,runtime,profile}.ts`, read tools, propose tools.
- Agents page in the app: runs, plans waiting for review/approval, flags.
- Approval in the app, with a Telegram ping linking to it.

## Phase 1: Reviewer agent

Job: check a maker's plan before a human sees it. It can block; it can't approve.

Deterministic checks first (code, tested):
- Plan foots: lines sum to totals; debits = credits for journals.
- Every line has evidence that exists (bank line, payout, order) and the amounts agree.
- Nothing already booked: Zoho ids re-verified live (the deleted-docs incident).
- Accounts come from the company profile map, not from the agent's guess.
- Currency and FX: residual within the profile's tolerance, booked to the profile's
  FX account.
- Period isn't locked; date is inside the period.
- One-writer rule: the doc type belongs to the agent that proposed it.
- Zoho budget: the plan's call count fits today's remaining budget.

Then a Claude pass on what code can't judge: does the explanation match the
evidence, is this a known exception pattern, is anything unusual for this company.

Output: `reviewed` or `blocked` with reasons per line, written to the plan.
Evals: the 7 incidents on the agent-org page + every case in
`omnia-books-closing/evals/evals.json`.

## Phase 2: the 13 engine agents

Each is a thin agent over code that already runs. Order: read-only first, writers
last (they need the Reviewer).

| # | Agent | Engine it drives | Trigger | Output | Writes | Portability work |
|---|---|---|---|---|---|---|
| 1 | ERP Sync | `lib/scheduler/*`, `zoho-sync.ts`, `payout-sync.ts` | schedule | sync health, failures as flags | none | read schedules/orgs from profile |
| 2 | Data Quality Monitor | clobber guard, `sale-rule`, Dubai-day helper | after each sync | flags | none | timezone + sale rule from profile |
| 3 | Audit Trail Builder | `audit.ts`, `sync_runs`, `agent_runs` | daily | daily audit log, gaps flagged | none | none |
| 4 | Duplicate Checker | `bank-dedupe.ts`, statement-account detection | on upload | duplicate flags, proposed removals | plan | account hints from profile |
| 5 | Invoice/Document Extractor | `lib/parsers/*` + LLM layer | on upload / email | canonical lines, footing result | plan | layered parsing above |
| 6 | Cash Position Analyst | money overview, awaiting payouts | daily | cash by bank, gateway, expected credits | none | banks from profile |
| 7 | Variance Analyst | `batch-advisor.ts`, insights | weekly + month end | variances with causes | none | none |
| 8 | Board Pack Author | `management-report*` | month end | management pack xlsx + summary | none | report definitions from profile |
| 9 | Excel Report Agent | recon / dispatch / COD exports | on request + month end | files | none | none |
| 10 | Filing Calendar Tracker | `config/rules.json` | daily | upcoming VAT/CT deadlines | none | client's periods in profile |
| 11 | Invoice Issuer | sales-orders daily close | daily | invoice plan | plan → approval | store → org map from profile |
| 12 | Payment Run Preparer | `supplier-payment.ts` | weekly | payment run plan | plan → approval | vendors/bank from profile |
| 13 | Intercompany Specialist | per-order org, COD voucher legs | on voucher | intercompany journal plan | plan → approval | entity list from profile |

"Writes: plan" means it can only propose. Posting needs Reviewer + approval.

## Phase 3: LinkedIn content agent

Job: one post a day from what really happened, in the founder's voice.

- Sources: shipped features (`git log`), anonymised incidents and lessons (no client
  names or numbers without permission), `config/rules.json` deadlines, client wins the
  client agreed to share.
- Every draft goes through `compliance-gate` rules: nothing claiming RAMZA is a tax
  agent or FTA-accredited, no "you are late" framing, no invented prices.
- Posting: LinkedIn's official API (Share on LinkedIn, `w_member_social`, for the
  founder's profile; Community Management API for a company page). Added as a
  connector in `lib/connectors` (new category `social`).
- Autonomy: drafts approved in Telegram first. After ~20 approved posts with no edits,
  the founder can switch the agent to auto-post.

## Phase 4: prospect agent (companies that already have the problem)

Job: build a daily short-list of companies showing a pain we solve, and prepare the
first touch.

- Signals (reuse `docs/ramza/outbound-playbook.md` ICP): checkout shows BNPL + several
  gateways or COD; Shopify/Woo/Salla/Zid store; hiring an accountant or bookkeeper;
  Dec year-end businesses in the CT window; e-invoicing scope.
- Enrichment: Apollo (already connected) for the decision maker and company size.
- Output per company: the observed signal, the score, a connection note and a first
  message that talks about their stack, all in a queue in the app.
- Sending:
  - Email goes out through the existing Instantly pipeline.
  - LinkedIn connection requests and DMs are **sent by the founder** from the queue
    (about 20–25 a day). LinkedIn's terms ban automated connection requests and
    messages, and accounts that use bots get restricted. The founder's profile is the
    main channel, so the agent does the research and writing, the person clicks send.
- Feedback: replies and meetings are logged, and the agent re-weights signals by what
  converts.

## Phase 5: prove it works for another company

"Passes every company" becomes a test, not a hope:
- Conformance suite: each agent runs its evals against Omnia + 2 synthetic companies
  (different base currency, gateways, banks, single vs multi-org).
- Then a real second tenant: the design partner (Sweet Dream) or a demo Zoho org,
  provisioned with `docs/new-client-deployment.md`, profile filled, agents in
  `propose_only`.
- An agent ships to clients only when it passes the suite.

## Decisions taken in this plan

- Agents run in the app via the Claude API, not as Claude Code subagents.
- Agents never hold ledger write tools. Proposals only; posting stays in tested code.
- LinkedIn sends stay human; drafting and research are automated.

## Open questions for the founder

- Founder's personal profile, a RAMZA company page, or both for the daily post?
- Approval channel: Telegram only, or also email?
- Which second company to test against first?
