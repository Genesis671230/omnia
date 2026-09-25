# n8n Recipes — Omnia Finance OS

> **⚠️ SUPERSEDED (as of 2026-08-08).** This was the Phase-1 prototype: three n8n workflows sharing a Google Sheet as the database. The system has since been rebuilt in this repo as a Next.js/TypeScript app with Supabase as the database and persistent in-process schedulers (see `../SKILL.md`, "Current architecture"). Kept here for historical context — the reasoning behind early design decisions is still valid, but **do not build new work against n8n, that Google Sheet, or the `@Omniafinancebot` bot referenced below; they are not the live system.**

Exact node configs, SDK gotchas, and copy-paste code proven on this project. Read the section you need.

## Table of contents
1. SDK gotchas & required workflow
2. Workflow A — Master Orders Sync (nodes + normalizer code)
3. Workflow B — Telr Payout Ingest (nodes + parser code)
4. Workflow B — Stripe (notes)
5. Workflow C — Bank matching + Awaiting (plan + parsers)
6. Founder brief composer (code)
7. Credentials & IDs

---

## 1. SDK gotchas & required workflow

- Tools are deferred: `tool_search` FIRST to load `n8n:get_node_types`, `n8n:update_workflow`, etc. before calling them.
- `n8n:validate_workflow` BEFORE every create/update. Fix all warnings.
- **SDK forbids `function` declarations** — inline everything (no helper functions at top level of the workflow file). Arrow-function consts inside a Code node's `jsCode` string are fine.
- Merge node: set `numberInputs` to match branches; wire each to `combine.input(0)`, `.input(1)`, … A branch wired to the wrong index silently produces a single-input merge.
- Google Sheets `sheetName` resource locator: use `mode:'list'` with a numeric gid, or `mode:'name'` with the exact tab name. A title string in `id`/`list` mode won't resolve.
- Editing live workflows: the user may rename nodes in the UI between turns — re-`get_workflow_details` before `update_workflow`, and target current node names. Atomic ops fail wholesale if one node name is wrong.
- `update_workflow` schema edits: use `setNodeParameter` with a JSON-pointer `path` (e.g. `/columns/schema`), not `updateNodeParameters` with a `path`.

## 2. Workflow A — Master Orders Sync

**Nodes:** Schedule (hourly) → 3× Shopify `getAll` + 1× WooCommerce `getAll` → Merge (append, numberInputs:4) → Code (Normalize) → Google Sheets `appendOrUpdate` (match on `uid`).

**Shopify node** (`n8n-nodes-base.shopify` v1): `resource:'order', operation:'getAll', authentication:'accessToken', returnAll:true`, options `{ status:'any', createdAtMin: "={{ $today.minus({ days: 30 }).toISO() }}", fields:'id,order_number,name,payment_gateway_names,financial_status,fulfillment_status,currency,total_price,total_price_set,created_at,customer' }`. **Each store needs its OWN credential** — n8n auto-assigns one credential to all three; you must reassign per node or all three pull the same store.

**WooCommerce node** (`n8n-nodes-base.wooCommerce` v1): `resource:'order', operation:'getAll', returnAll:true`, options `{ after: "={{ $today.minus({ days: 30 }).toISO() }}" }`.

**Store tagging:** Shopify orders don't carry a store label. Either (a) add a Set node after each Shopify node stamping `__store:'WA'`/`'UAE'`/`'KSA'` before the merge, or (b) rely on globally-unique Shopify order IDs and use `SHOP_<id>` (loses the store column). Prefer (a) for clean per-store reporting.

**Normalize (Code node, runOnceForAllItems)** — auto-detects store by JSON shape, maps to canonical schema, digs Telr refs from Woo `meta_data`:

```javascript
const items = $input.all();
const out = [];
const num = v => { const n = parseFloat(String(v==null?'':v).replace(/[^0-9.\-]/g,'')); return isNaN(n)?0:n; };
const wooMeta = (o,key)=>{ const md=o.meta_data; if(!Array.isArray(md)) return ''; const h=md.find(m=>m&&m.key===key); return h?String(h.value==null?'':h.value):''; };
const wooFin = s=>{ s=String(s||'').toLowerCase(); if(['completed','processing'].includes(s)) return 'paid'; if(s==='refunded') return 'refunded'; return s; };

for (const it of items){
  const o = it.json;
  const isWoo = Array.isArray(o.meta_data) || (o.billing && o.payment_method !== undefined);
  const isShopify = (o.total_price !== undefined) || o.total_price_set !== undefined;

  if (isWoo){
    const orderId = String(o.id ?? o.number ?? '').trim();
    const bill = o.billing || {};
    const customer = [bill.first_name, bill.last_name].filter(Boolean).join(' ').trim();
    let gateway = String(o.payment_method||'').trim(); // 'wctelr', 'cod', ...
    if (/telr/i.test(gateway) || /telr/i.test(String(o.payment_method_title||''))) gateway='Telr';
    if (/^cod$/i.test(gateway)) gateway='COD';
    out.push({ json: {
      uid:'WOO_'+orderId, store:'WOO', order_id:orderId, order_number:String(o.number ?? orderId),
      order_date:String(o.date_created||o.date_created_gmt||'').slice(0,10), customer,
      currency:String(o.currency||'AED'), gross_original:num(o.total), gross_aed:num(o.total),
      gateway, telr_cartid:wooMeta(o,'_telr_cartid'), telr_tranref:wooMeta(o,'_telr_auth_tranref'),
      financial_status:wooFin(o.status), fulfillment_status:String(o.status||''), source:'woocommerce'
    }});
    continue;
  }
  if (isShopify){
    const orderId = String(o.id ?? '').trim();
    const cust = o.customer || {};
    const customer = [cust.first_name, cust.last_name].filter(Boolean).join(' ').trim();
    let grossAed=num(o.total_price), origCur=String(o.currency||''), grossOrig=num(o.total_price);
    if (o.total_price_set && o.total_price_set.shop_money){
      grossAed = num(o.total_price_set.shop_money.amount);
      if (o.total_price_set.presentment_money){
        grossOrig = num(o.total_price_set.presentment_money.amount);
        origCur = String(o.total_price_set.presentment_money.currency_code||origCur);
      }
    }
    // Shopify gateway lives in payment_gateway_names (array), NOT a `gateway` field
    let gw = Array.isArray(o.payment_gateway_names) ? o.payment_gateway_names.join(',') : String(o.gateway||'');
    const store = o.__store || 'SHOP';
    out.push({ json: {
      uid: store+'_'+orderId, store, order_id:orderId,
      order_number:String(o.order_number ?? o.name ?? ''), order_date:String(o.created_at||'').slice(0,10),
      customer, currency:origCur, gross_original:grossOrig, gross_aed:grossAed,
      gateway:gw, telr_cartid:'', telr_tranref:'',
      financial_status:String(o.financial_status||''), fulfillment_status:String(o.fulfillment_status||''), source:'shopify'
    }});
    continue;
  }
}
return out;
```

**Write node**: Google Sheets v4.7, `operation:'appendOrUpdate'`, `sheetName mode:'name' value:'Master_Orders'`, `mappingMode:'autoMapInputData'`, `matchingColumns:['uid']`, schema = the 15 canonical columns (uid marked `canBeUsedToMatch:true`).

## 3. Workflow B — Telr Payout Ingest

**Nodes:** Form Trigger (multi-file, `.xls`) → Extract from File (`xls`, headerRow:false) → Code (Normalize Telr) → 2× Filter (`_kind == ledger` / `== recon`) → 2× Google Sheets append (`Telr_Ledger`, `Telr_Recon`).

**Form Trigger** (`n8n-nodes-base.formTrigger` v2.6): one file field, `multipleFiles:true`, `acceptFileTypes:'.xls,.xlsx,.csv'`. The binary property name derives from the field label with spaces→underscores (e.g. label "Telr payout files" → `Telr_payout_files`). Verify on first run; if wrong, it's a one-field fix.

**Extract from File** (`n8n-nodes-base.extractFromFile` v1.1): `operation:'xls'`, options `{ headerRow:false, includeEmptyCells:true, readAsString:true }`. headerRow:false is essential — the banner row is above the table.

**Normalize Telr (Code, runOnceForAllItems)** — scans cells AND keys for the Payout ID banner, extracts order from CartID, sums Net per payout:

```javascript
function cells(j){
  if (Array.isArray(j.row)) return j.row.map(x=>String(x==null?'':x));
  const keys = Object.keys(j).filter(k=>k!=='_telr_file' && k!=='row_number');
  return keys.map(k=>String(j[k]==null?'':j[k]));
}
const num = v => { const n = parseFloat(String(v==null?'':v).replace(/[^0-9.\-]/g,'')); return isNaN(n)?0:n; };
const items = $input.all();
let currentPayout = null;
const ledger = [];
for (const it of items){
  const c = cells(it.json);
  const joined = c.join(' ') + ' ' + Object.keys(it.json).join(' ');
  const pm = joined.match(/Payout\s*ID\s*([0-9]{4,})/i);
  if (pm){ currentPayout = pm[1]; continue; }
  const cartCell = c.find(x=>/^[0-9]{3,}_[0-9a-f]+/i.test(x.trim()));
  if (!cartCell){ continue; } // skips header/section/blank rows
  const order = cartCell.trim().split('_')[0];
  let net = 0;
  for (let i=c.length-1; i>=0; i--){ const v=c[i].trim(); if (/^-?[0-9][0-9,\.]*$/.test(v)){ net = num(v); break; } }
  ledger.push({ payout_id: currentPayout||'UNKNOWN', order_number: order, cart_id: cartCell.trim(), ref: (c[0]||'').trim(), net_aed: net });
}
const byPayout = {};
for (const l of ledger){ const p=l.payout_id; if(!byPayout[p]) byPayout[p]={payout_id:p,orders:0,net_aed:0}; byPayout[p].orders++; byPayout[p].net_aed+=l.net_aed; }
const out = [];
for (const l of ledger) out.push({ json: { _kind:'ledger', ...l } });
for (const p of Object.values(byPayout)) out.push({ json:{ _kind:'recon', payout_id:p.payout_id, orders:p.orders, net_aed:Math.round(p.net_aed*100)/100, bank_deposit:'', payout_date:'', delta:'', status:'PENDING_BANK' } });
if (out.length===0) out.push({ json:{ _kind:'recon', payout_id:'NONE', orders:0, net_aed:0, status:'NO_ROWS_PARSED' } });
return out;
```

If `payout_id` comes out `UNKNOWN`, the CSV/xls dropped the banner → name each file with its payout id (`4841777.xls`) and read the id from the filename instead.

`Telr_Ledger` cols: `payout_id · order_number · cart_id · ref · net_aed`. `Telr_Recon` cols: `payout_id · orders · net_aed · bank_deposit · payout_date · delta · status`.

## 4. Workflow B — Stripe (notes)

Already built and proven (21/21). Input = Stripe **payout reconciliation report** CSV (has `automatic_payout_id`). Group charges by `automatic_payout_id` → sum net → match to bank. Order refs from the human-typed `description` need a parser (handle `WAxxxxx`, `SAxxxxx`, numeric, multi-order `A/B` & `A & B`, refunds `REFUND FOR CHARGE (X)`, blanks). Three tabs: `Stripe_Ledger` (per order), `Stripe_Recon` (per payout), `Stripe_Exceptions` (blanks/multi/not-in-dashboard). Same skeleton as Telr — swap column detection + bank keyword (`NETWORK...STRIPE`).

## 5. Workflow C — Bank matching + Awaiting

**Bank matching** (fills `bank_deposit`, `payout_date`, `delta`, `status` on `*_Recon`):
Form/Manual → Extract from File (`pdf`, joinPages:true) → Code (Parse Bank Lines) → read `*_Recon` → Code (Match by amount) → Google Sheets appendOrUpdate (match on `payout_id`).

Telr bank line format (real): the amount is on the statement row; the description contains
`...INNOVATE TECHNOLOGIES FZCO...REF/PO260626 0035 20446/FT26177FPJ1F`.
Parse: keep lines matching `/INNOVATE TECHNOLOGIES/i`; date from `/PO(\d{2})(\d{2})(\d{2})/` → `DD/MM/20YY`; `20446` = Telr merchant id; amount = the number on that statement row. Match each Telr payout's net to a bank line by amount (±0.02). On match: `payout_date` from the PO ref, `status='MATCHED'`. **The bank provides the payout date — it is not in the Telr file.**
Bank keywords: Telr `INNOVATE TECHNOLOGIES`; Stripe `NETWORK...STRIPE`; Tabby `TABBY LLC FZ`; Tamara `TAMARA FZE`; Checkout `Checkout MENA`.

**Awaiting (Tier 2, amount-level, reliable):**
```
awaiting[gateway] = sum(Master_Orders.gross_aed where gateway==G and financial_status=='paid')
                    - sum(<G>_Ledger.net_aed already paid out)
```
No per-order join needed. Report per-gateway totals to the founder.
**Awaiting (Tier 3, per-order)** — only reliable for WooCommerce: a Master_Orders WOO row whose `telr_tranref` is NOT present in `Telr_Ledger.ref` = awaiting. Defer Shopify per-order (no reliable ref).

## 6. Founder brief composer (Telegram, Markdown)

Cron 8AM → read `*_Recon` (+ Stripe_Exceptions) → Code compose → clear+write `Founder_Report` → Telegram sendMessage (`parse_mode:'Markdown'`).

Composer essentials (Code, runOnceForAllItems): filter recon rows `row_type=='payout'` (Stripe) or use Telr rows; count matched vs total; sum net; list recent payouts; **date formatter** must handle both `YYYY-MM-DD` and stray `YYYY-DD-MM` (detect which field >12). Keep the review-queue line honest ("N rows need a human: X blank, Y multi") and label pre-window/settlement-lag counts as expected, not alarming. End with per-gateway settled totals + awaiting amounts. Drive gateway numbers from clean `_Recon` tabs, NOT from a merged-cell summary tab (the Drive read tool mangles those and returns AED 0).

## 7. Credentials & IDs (this workspace)

- Google Sheets cred: `TxK6lh7RYZRZe2HW`. Sheet ID: `11J9I73pO8g8lKhFDTnRY4s-Ked7xZDOFrEap6Qy8FeM`.
- Telegram cred: `6pMY7q8s98mOi3QK`; chat id `6188540963`; bot `@Omniafinancebot`.
- Tab gids: Stripe_Recon 1504470502, Stripe_Exceptions 897481952, Founder_Report 1686447058, Coverage 0 (unreliable — don't source from it).
- Shopify domains: WA `whatsapp-omnia`, UAE `stzcx3-ee`, KSA `houseofomnia-dev` (API version 2023-10). Each needs its own Shopify Access Token credential. For orders >60 days, request `read_all_orders` scope (admin custom apps often auto-granted; else request via Partner Dashboard → app → API access).
- WooCommerce: `omniastores.com` REST `wp-json/wc/v3/orders`.
