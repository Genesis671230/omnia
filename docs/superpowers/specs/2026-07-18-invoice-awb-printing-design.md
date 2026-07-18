# Invoice & AWB printing (Subsystem A of the invoice/payment bundle)

Date: 2026-07-18
Status: **approved, not yet implemented**
Plan: (to be written — `docs/superpowers/plans/2026-07-18-invoice-awb-printing.md`)

## Why this spec exists

The founder ships orders to two destinations that need two different invoices:

- **UAE (Ontrack courier)** — a simple two-up shipping label already generated
  by `lib/invoice.ts` (OMNIA / ON TRACK letterhead, black-bar SHIP TO and
  REMARKS/ORDER VALUE/SHIPPING/TOTAL tables). Reference PDF:
  `omnia-invoice-718578.pdf`.
- **International, non-UAE (SMSA courier)** — a formal itemized commercial
  invoice needed for customs, which the app does **not** generate today. The
  founder supplied the exact target layout: `#SA3671, Saudi Arabia.pdf`.

The request: make invoice generation **fast and elegant**, auto-pick the right
template by destination, add the founder's "already paid" invoice rendering, and
give one-click **download** and **print** — including printing the SMSA AWB label
for international orders.

Payment confirmation (manual button + note, gateway-file upload, gateway API) is
a **separate subsystem (B)** and is explicitly **out of scope** for this spec. It
will get its own spec after this ships.

### Confirmed decisions (from brainstorming)

1. **Sequence** — invoice + AWB printing first; payment confirmation later.
2. **International invoice line code** — the **ITEM # column = the order number**
   (the founder's "basically order id"), *not* a customs HS code. Description
   comes from the order's line-item titles. The sample's "Made in China" origin
   note is kept as an **editable default** appended to the description (it is on
   the real customs invoice); can be dropped at review.
3. **Print AWB** — invoice and AWB label print as **two separate documents**, not
   a merged PDF. The AWB must already exist (issued via the existing Ship step);
   the Print-AWB action is disabled until it does. Printing does **not** trigger
   AWB creation.
4. **Paid layout** — for a paid (non-COD) order: `REMARKS = PAID`,
   `SHIPPING = AED 30`, `ORDER VALUE = the amount`, and the `TOTAL` cell renders
   the literal word **"PAID"** instead of a number. Auto-applied, still editable.

## Current state (confirmed by reading the code)

- `lib/invoice.ts` — `buildInvoicePdf(fields: InvoiceFields): Promise<Uint8Array>`
  draws the Ontrack two-up label with `pdf-lib`. `InvoiceFields.total` is a
  `number`; the TOTAL cell is rendered via `money(currency, total)`. `paid` is
  free text ("Yes"/"No"/"COD"). `winAnsiSafe()` strips non-Latin-1 (Arabic)
  characters so names/cities don't crash the PDF.
- `components/finance/invoice-modal.tsx` — editable prefill, `POST`s to
  `/api/orders/:uid/invoice`, downloads the returned blob. Rendered through a
  `createPortal(..., document.body)` (the portal fix) with self-contained hex
  colors, since the finance `--tokens` live inside `.wrap`, not `:root`.
- `app/api/orders/[uid]/invoice/route.ts` — `GET` (auto-fill quick download) and
  `POST` (founder-edited fields). Both call `buildInvoicePdf(prefill(order) …)`.
  `prefill()` maps an order to `InvoiceFields`.
- `components/finance/ship-modal.tsx` + `lib/integrations/smsa.ts` +
  `app/api/orders/[uid]/ship/route.ts` — issue a real SMSA AWB (SOAP). On
  success the order gets `awb_number` + `label_url = /api/orders/:uid/label`.
- `app/api/orders/[uid]/label/route.ts` — serves the SMSA AWB label PDF.
- `components/finance/orders-ledger.tsx` — expandable rows. `ExpandedOrder`
  renders the action buttons: an **Invoice** button (always) and, for a
  non-AE order without an AWB, a **Ship** button; once shipped, an **AWB** link
  to the label. `isShippable(o)` = country != AE && no `awb_number`.
- `lib/courier.ts` — `defaultCourier(country)` = AE → "Ontrack", else "SMSA".
  This is the same AE/non-AE split used for template selection.
- Order detail (`GET /api/orders/:uid`) returns `line_items: { title, sku, qty,
  total_aed, image_url?, stock? }[]`. The list endpoint strips line items for
  payload weight, so the international modal must lazy-fetch them per order.
- `OrderRow` (in `lib/types/orders.ts`) has `country`, `gateway`, `currency`,
  `gross_aed`, `customer_name`, `customer_phone`, `city`, `awb_number`,
  `label_url`, `financial_status`. There is **no** `customer_email` on
  `OrderRow`, though `GET /api/orders/:uid` (order detail) and the ship route
  reference `customer_email` — the intl invoice's Email field will use the
  detail fetch's email if present, else blank/editable.

## Architecture (Approach A — chosen)

One invoice route, two generator modules, one template-aware modal. Rejected
alternatives: separate routes+modals per template (duplication); a single
mega-generator with branching layout (one tangled function).

### 1. `lib/invoice.ts` — Ontrack generator, paid-total support

Change `InvoiceFields` so the TOTAL cell can render text:

- Add `totalLabel?: string`. When present, the TOTAL cell draws `totalLabel`
  (e.g. `"PAID"`) instead of `money(currency, total)`. When absent, behavior is
  unchanged (numeric total). This keeps `total: number` for callers that still
  want the number and avoids a breaking type change.
- No other layout change. The existing two-up block, borders, header stay a
  pixel-match of the reference.

### 2. `lib/invoice-intl.ts` — **new** international commercial invoice

`buildIntlInvoicePdf(fields: IntlInvoiceFields): Promise<Uint8Array>`, drawn with
`pdf-lib`, reproducing `#SA3671, Saudi Arabia.pdf`:

```
IntlInvoiceFields = {
  invoiceNo: string;          // = order number
  customerId: string;         // e.g. "#SA3671" — editable, prefilled (see below)
  date: string;               // dd/mm/yy display, caller-formatted
  // ship-to and bill-to are the same block in the sample; captured once,
  // printed in both columns:
  name: string;
  address: string;            // multi-line street/city/country
  tel: string;
  email: string;
  // strip row (SALESPERSON / P.O.# / SHIP DATE / SHIP VIA / F.O.B. / TERMS):
  shipDate: string;           // defaults to date
  terms: string;              // default "-"
  items: {
    itemNo: string;           // = order number (per decision 2)
    description: string;      // product title + editable origin note
    qty: number;
    unitPrice: number;        // AED
  }[];
  shipping: number;           // AED
  currency: string;           // "AED" per sample
  contactName: string;        // footer, default "Omnia Fouad"
  contactEmail: string;       // footer, default "support@omniastores.com"
  contactPhone: string;       // footer, default "+971565478227"
}
```

- SUBTOTAL = Σ(qty × unitPrice); TOTAL = SUBTOTAL + shipping.
- Reuse the `winAnsiSafe()` Arabic-stripping approach (extract it to a shared
  helper or duplicate the small function) so Arabic names/addresses don't crash
  the PDF. Same fonts (Helvetica family) as `lib/invoice.ts`.
- Single A4 page (not two-up); the commercial invoice is one copy.

### 3. `lib/print.ts` — **new** tiny client print helper

`printBlob(blob: Blob): void` and/or `printUrl(url: string): void`. Loads the PDF
into a hidden `<iframe>` appended to `document.body`, waits for load, calls
`iframe.contentWindow.print()`, and cleans up afterward. This is the only way a
web page reaches the OS printer — there is no direct printer socket. Print-AWB
uses `printUrl('/api/orders/:uid/label')`.

### 4. `components/finance/invoice-modal.tsx` — rebuilt, template-aware

- Keep the portal render + self-contained hex + framer-motion enter/exit + the
  bulk-invoice `queueRemaining` prop (do not regress those).
- **Template toggle** at the top: `Ontrack (UAE)` ⇄ `International`, defaulted by
  `defaultCourier(order.country)` (AE → Ontrack, else International). Reachable
  for any order (a UAE customer can be switched to the itemized invoice, and
  vice-versa) — decision left open at design review, defaulting to "toggle
  always available."
- **Ontrack mode** fields as today, plus paid auto-fill: when the order is paid
  (`gateway !== "COD"` and not explicitly unpaid), default `remarks = "PAID"`,
  `shipping = 30`, and set `totalLabel = "PAID"`; the Total readout shows "PAID".
  Editable — clearing remarks/label reverts to numeric total.
- **International mode** lazy-fetches `GET /api/orders/:uid` on first switch to
  populate the item table (title → description, qty, unit price from
  `total_aed / qty`) and prefill name/address/tel/email. `customerId` prefilled
  as `#{countryCode}{orderNumber}` (e.g. `#SA3671`), editable. Each item's
  description gets the editable "Made in China" origin default appended.
- **Actions:** `Download invoice` and `Print invoice` (both post to the route
  and act on the returned blob — download vs `printBlob`). For a **non-AE**
  order, a third action `Print AWB label` appears, enabled only when
  `order.awb_number` exists; disabled with a hint ("Ship first to get an AWB")
  otherwise. AWB prints as a separate document via `printUrl(order.label_url)`.

### 5. `app/api/orders/[uid]/invoice/route.ts` — route by template

- Accept `template: "ontrack" | "intl"` in the `POST` body (and optional
  `?template=` on `GET`). Default from `defaultCourier(order.country)`.
- `ontrack` → `buildInvoicePdf` with `prefill(order)` merged with edits
  (including optional `totalLabel`).
- `intl` → new `prefillIntl(order, detail)` → `buildIntlInvoicePdf`. Line items
  come from the order detail (route reads them server-side so the client can't
  forge totals). `Content-Disposition` filename stays
  `omnia-invoice-<orderNumber>.pdf`.

### Data flow

```
Ledger row → Invoice button → InvoiceModal (portal)
  ├─ template auto-picked (country) with toggle
  ├─ Ontrack: prefilled fields, paid-semantics auto-fill
  ├─ International: lazy GET /api/orders/:uid → item table + ship/bill/tel/email
  ├─ Download invoice → POST /api/orders/:uid/invoice {template,...} → blob → download
  ├─ Print invoice   → POST … → blob → printBlob() (hidden iframe → print dialog)
  └─ Print AWB label  (non-AE, AWB exists) → printUrl('/api/orders/:uid/label')
```

## Error handling

- International mode with no line items on the order → show an inline notice and
  fall back to a single line row (order number / "Order #N" / qty 1 / order
  value) so an invoice can still be produced.
- Line-item lazy fetch fails → inline error + retry; keep the modal open.
- `printBlob` in a browser that blocks programmatic print → the same blob is
  still downloadable via the Download action (never a dead end).
- PDF generation throwing (bad input) → route returns 500 with the message; modal
  toasts the failure, stays open (mirrors current behavior).
- Print-AWB pressed with no AWB → action is disabled, not an error.

## Testing

Unit tests on the pure logic (no PDF-snapshot infra exists in the repo, so assert
structure/bytes, not pixels):

- **Template selection** — `defaultCourier`/selection: AE → ontrack, SA/KW/etc →
  intl.
- **Paid semantics** — the prefill/derivation that sets `remarks="PAID"`,
  `shipping=30`, `totalLabel="PAID"` when paid, and leaves numeric total when COD
  or explicitly unpaid.
- **Intl field mapping** — `prefillIntl` maps line items → item rows (itemNo =
  order number, unit price = total_aed/qty), customerId = `#{country}{number}`,
  subtotal/total math.
- **Generators don't throw** — `buildInvoicePdf` (with `totalLabel`) and
  `buildIntlInvoicePdf` return non-empty `Uint8Array` for: normal input, Arabic
  name/address, empty/missing line items.

Manual verification after build: drive the modal for one AE and one non-AE order,
confirm the right template, paid rendering, download, print dialog, and (for a
shipped non-AE order) the separate AWB print.

## Out of scope

- **Payment confirmation** (manual / gateway-file / gateway-API) — Subsystem B,
  its own spec.
- Merged invoice+AWB PDF (decision: two separate documents).
- A product→HS-code lookup table (decision: item # is the order number).
- Persisting generated invoices (they remain generated-on-demand, not stored).
- Changing the SMSA ship flow or the AWB label format.
