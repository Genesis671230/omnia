# New client deployment (one copy per client)

Each client runs its **own copy** of this codebase: its own Supabase project,
its own deployment, its own env. Nothing is shared with Omnia, so a client can
never see another client's data. (Shared multi-tenancy for self-serve
"House of Solopreneurs" signup is planned separately.)

Time: about half a day once the client has handed over access.

## 1. Collect from the client

- [ ] Zoho Books: the org owner generates **Self Client** credentials at
      api-console.zoho.com → Self Client → scope `ZohoBooks.fullaccess.all`
      → generate code → exchange for a refresh token. You need client ID,
      client secret, refresh token. (Narrower scopes lock parts of the app —
      the Zoho Books tab shows which.)
- [ ] Which Zoho data centre they are on (`.com`, `.sa`, `.eu`, `.in` …)
- [ ] Stores: Shopify admin API token per store and/or WooCommerce keys
- [ ] Payment gateways they use (Stripe / Tabby / Tamara / Telr / Checkout / COD courier)
- [ ] Bank statement export for the first month

## 2. Database

1. Create a new Supabase project for the client (region nearest them).
2. Build the schema — the script refuses any database that already has tables:

   ```bash
   DATABASE_URL='postgres://…new project…' node db/provision-client.mjs
   ```

   `db/bootstrap.sql` is the full structure (tables, functions, indexes);
   `db/schema.sql` is applied on top. Neither contains data.

## 3. Deployment

1. New deployment of this repo (same branch as Omnia).
2. Env: start from `.env.client.example`. Generate **fresh**
   `OMNIA_SESSION_SECRET` and `ZOHO_CREDENTIALS_KEY` — never reuse Omnia's.
3. Put the client's **primary** Zoho organisation in `ZOHO_*`.
4. List only the client's stores in `SHOPIFY_STORE_CODES` with their
   `SHOPIFY_<CODE>_URL` / `_TOKEN`.
5. Set role passwords (`OMNIA_PW_ADMIN`, `OMNIA_PW_FINANCE`, …) and send them
   to the client separately.

## 4. In the app

1. Settings → **Zoho organisations**: test the primary org; add any other
   organisations (e.g. a second trading entity); set upload routing
   (e.g. COD vouchers → the entity that invoices COD orders).
2. Settings → **posting accounts**: map bank, fee and clearing accounts —
   once per organisation ("Mapping for").
3. Reconciliation → upload the first bank statement and payout files.
4. Reconciliation → **Zoho Books** tab: confirm entities load and nothing
   important shows a lock.

## 5. Keeping copies up to date

- Code: redeploy each client copy from the same branch.
- Schema: after a deploy, run `node db/apply-schema.mjs` against each
  client's database (it is idempotent).
- When `db/schema.sql` gains a **new table**, regenerate `db/bootstrap.sql`
  from Omnia's database so future clients get it:

  ```bash
  pg_dump --schema-only --schema=public --no-owner --no-privileges --no-comments \
    -f /tmp/b.sql   # then strip `\restrict` lines + `SET transaction_timeout`,
                    # keep `CREATE SCHEMA IF NOT EXISTS public;`, the pg_trgm
                    # line and the trailing `RESET search_path;`
  ```

## Known limits of a copy today

- **Zoho data centre**: organisations added in Settings follow their data
  centre for the Zoho Books tab, but the booking/sync code still calls
  `www.zohoapis.com`. Clients on `.sa` / `.eu` / `.in` need that wired
  before their books can be closed.
- **Omnia-specific rules** (WhatsApp-store prepaid orders, the House of Omnia
  COD routing, store codes WA/UAE/KSA/MAIN in reports) simply don't apply to
  another business's data; review the dashboard's store labels with the
  client.
- **Logins** are the fixed role accounts in `lib/auth-config.ts`, one set per
  copy.
