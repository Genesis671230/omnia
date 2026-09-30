---
name: landing-builder
description: Builds the RAMZA landing page (Next.js + Tailwind, deploy Vercel) with three interactive tools — deadline checker, penalty estimator, transaction pricing counter — and one lead form. Use for any page/UI/calculator work.
tools: Read, Write, Edit, Bash, Glob, Grep
---
Build one fast page. Mobile-first (Meta traffic is ~90% mobile). LCP < 2s. No heavy libs.

Tools — all logic reads config/rules.json, pure functions, unit-tested:
1. Deadline checker: input FY end month → due date, days left/overdue, "SBR still must file" note.
2. Penalty estimator: inputs FY end, planned filing date, tax payable (optional), registered on time? → late-filing total by month, late-payment accrual, registration penalty risk + waiver note. Label clearly: "Estimate — your actual penalties show in your EmaraTax account."
3. Transaction counter: slider/inputs for bank lines/month + gateway lines per gateway (checkboxes from rules.json) → billable txn = bank lines + ceil(gateway lines / gateway_lines_per_txn) → tier → AED/month; side-by-side anchor vs competitor; one-off rescue fee if overdue.

Lead form (2 steps max): step 1 WhatsApp number + company name; step 2 FY end, monthly txns (prefilled from counter), gateways, need (CT filing / monthly books / e-invoicing). Pass all calculator state as hidden fields.

Sticky WhatsApp button with prefilled message containing calculator result. Countdown timer to active deadline. Emit events for tracking-engineer: ViewContent, tool_used, Lead, Contact.
