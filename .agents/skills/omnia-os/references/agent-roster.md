# Omnia finance agent roster

A team of specialist agents that share one set of books. Each has a narrow job, its
own skills and memory, and a clear line on what it may write. They coordinate through
the app's data (Supabase, Zoho) and review flags, not through each other's chat.

Status: **built** = agent file exists in `.claude/agents/`; **next** = designed, not
built; **later** = needs inputs we don't have yet.

## The roster

| Agent | Status | Owns | May write | Hands off to |
|---|---|---|---|---|
| **Controller** | next | The monthly close calendar; runs the others in order; the one report to the founder | Nothing in Zoho; review flags; the close checklist | Everyone |
| **omnia-books-specialist** (reconciliation & close) | built | Bank → payout → order matching; customer payments, gateway fees, VAT on fees, FX journals, refunds, credit notes; exception flags | Zoho payments / expenses / journals / credit-note refunds through the app's engine, on a named approval | VAT agent (tax treatment), Payables (supplier bank debits) |
| **Payables & expenses** | next | Supplier bills, bank debits (salaries, rent, ads, couriers), expense categorisation, bank-feed lines not yet in Zoho | Expenses / bills via `post-bank-lines`, on approval | VAT agent (input VAT), Reporting |
| **Reviewer** (maker-checker) | next | Checks another agent's dry-run plan before it posts: totals foot, accounts right, nothing double-booked | Nothing; approves or blocks with reasons | The agent that asked |
| **VAT — UAE** | later | Output VAT on sales, input VAT on fees and bills, VAT return workpapers per period, reconciliation of the VAT accounts to the return | Nothing in Zoho; prepares workpapers and a draft return for a human to file | Controller |
| **VAT — KSA / GCC** | later | Whether and how KSA / Kuwait / Qatar sales create registration or filing duties; workpapers if registered | Nothing; advice and workpapers only | Controller |
| **Corporate tax — UAE** | later | Taxable income from the books, adjustments, provision, annual return workpapers | Journals for the tax provision, on approval | Reporting |
| **Reporting** | next | Month-end pack: P&L, balance sheet, cash, gateway cost %, sales by store / channel, variances vs last month | Reports only (Excel / app pages) | Controller |

### Shared rules (every agent)

1. **Bank is the truth; Zoho is the book.** Local "booked" flags are hints, never proof.
2. **Dry run → named approval → post → read back → flag.** No agent posts on another
   agent's say-so alone; the Reviewer can block, only the founder can approve.
3. **One writer per document type.** The books specialist owns customer payments and
   gateway costs; Payables owns bills and bank debits; tax agents write only provisions.
   Two agents never post the same kind of document for the same period.
4. **Flags are the inbox.** Anything held becomes a review flag with both numbers and
   the action needed; the Controller rolls them into the founder report.
5. **Zoho limits are shared.** All agents draw from one daily budget and one OAuth
   client. The Controller schedules heavy jobs (ledger snapshot, month dry runs) so they
   don't overlap.

## What the tax agents need before they are built

These are rules with legal consequences. The agent is only as right as its inputs, so
each item below must come from Omnia's registration documents or its tax advisor, and
be written into that agent's skill, before the agent exists:

- **UAE VAT**: TRN, tax period (monthly or quarterly per the FTA registration), filing
  method (EmaraTax), the standard rate (5%) and which supplies are zero-rated (exports to
  other GCC states / outside the UAE) or out of scope, the place-of-supply rule applied
  to cross-border e-commerce sales, treatment of gateway fees (input VAT is already
  split on AED fees; confirm reverse charge on foreign gateways' fees), and bad-debt /
  credit-note adjustments.
- **KSA and other GCC**: whether Omnia is registered or required to register (sales
  thresholds, distance-selling rules), and if so the rate (KSA 15%), e-invoicing (ZATCA)
  obligations and filing periods. Until confirmed, the agent only reports exposure.
- **UAE corporate tax**: tax period (financial year), the 9% rate above the threshold
  and whether small-business relief applies, non-deductible items, and who signs.
- **Filing stays human.** Agents prepare workpapers and draft returns; a person submits
  to the FTA / ZATCA.

## Can agents evolve?

Yes, but not by rewriting themselves in the dark. They improve through a supervised
loop, which keeps them trustworthy with money:

```
work → memory → proposal → review → skill → test → better work
```

1. **Memory (automatic).** Each agent has `memory: project`. After a job it saves
   durable facts: account ids, gateway quirks, the founder's standing decisions. Next
   session it starts from them. This is where "understanding the company" accumulates.
2. **Playbook proposals (agent-drafted, human-approved).** When an agent meets a case
   its skill didn't cover, it ends its report with a "Proposed playbook addition"
   (symptom → prove → fix → book or flag). A maintainer promotes good ones into the
   skill's references (e.g. `omnia-books-closing/references/exceptions-playbook.md`).
3. **Regression cases (the safety net).** Every resolved incident becomes an eval case
   (`omnia-books-closing/evals/evals.json`). Before a skill change ships, the agent is
   re-run on those cases; a change that fixes one case and breaks another doesn't ship.
   `skill-creator` runs these and also tunes when each skill triggers.
4. **Code fixes (with tests).** When the cause is a bug, the agent fixes it with a
   regression test. The code gets better along with the agent.
5. **Promotion of autonomy.** An agent earns wider permission per task type once its
   dry runs for that type have matched the founder's decisions for a sustained period
   (e.g. "fee-only re-posts: auto-post" after a month with no corrections). Autonomy is
   granted per document type, written into the agent file, and can be revoked.

What they cannot do: change their own permissions, approve their own posts, or learn
tax rules from patterns in the data. Those always come from a person.

## Build order

1. Reviewer (cheap, makes every posting agent safer).
2. Payables & expenses (bank debits are most of the unreconciled SIB lines).
3. Reporting (reads only; immediate value).
4. Controller (once 1–3 exist).
5. Tax agents, after the inputs above are confirmed.
