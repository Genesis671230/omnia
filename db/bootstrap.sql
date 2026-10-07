-- Omnia Finance OS — full database structure for a NEW deployment (a new
-- client's own Supabase project). Structure only: no rows, no secrets.
--
--   1. psql "$DATABASE_URL" -f db/bootstrap.sql     (fresh, empty database)
--   2. node db/apply-schema.mjs                      (idempotent migrations on top)
--
-- Generated with pg_dump --schema-only --schema=public --no-owner
-- --no-privileges from the live Omnia database on 2026-09-29. db/schema.sql alone
-- cannot build a database: it only ALTERs tables that were first created by
-- hand. Regenerate this file whenever schema.sql adds a table:
--   see docs/new-client-deployment.md
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;

-- Trigram indexes (fuzzy search) use pg_trgm from the public schema. Other
-- extensions the app relies on (pgcrypto, uuid-ossp) ship with every new
-- Supabase project in its own `extensions` schema.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: Courier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Courier" AS ENUM (
    'SMSA',
    'ONTRACK'
);


--
-- Name: ExchangeMode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ExchangeMode" AS ENUM (
    'SWAP_ON_DELIVERY',
    'RECEIVE_FIRST',
    'STANDARD'
);


--
-- Name: ItemCondition; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ItemCondition" AS ENUM (
    'GOOD',
    'DAMAGED',
    'UNSPECIFIED'
);


--
-- Name: ReturnScope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ReturnScope" AS ENUM (
    'LOCAL',
    'INTERNATIONAL'
);


--
-- Name: ReturnStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ReturnStatus" AS ENUM (
    'REQUESTED',
    'APPROVED',
    'AWAITING_PICKUP',
    'RECEIVED',
    'RESOLVED',
    'REJECTED'
);


--
-- Name: ReturnType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ReturnType" AS ENUM (
    'REFUND',
    'EXCHANGE'
);


--
-- Name: Role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Role" AS ENUM (
    'ADMIN',
    'USER',
    'MANAGER',
    'SUPPLIER',
    'MARKETER'
);


--
-- Name: bump_heartbeat(text, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_heartbeat(p_source text, p_topic text, p_id text, p_ts timestamp with time zone) RETURNS void
    LANGUAGE sql
    AS $$ insert into webhook_heartbeat (source, topic, last_seen, last_id, count_1h) values (p_source, p_topic, p_ts, p_id, 1) on conflict (source, topic) do update set last_seen = excluded.last_seen, last_id = coalesce(excluded.last_id, webhook_heartbeat.last_id), count_1h = case when webhook_heartbeat.last_seen > now() - interval '1 hour' then webhook_heartbeat.count_1h + 1 else 1 end; $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: reconcile_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconcile_tasks (
    id bigint NOT NULL,
    sku text NOT NULL,
    reason text NOT NULL,
    priority smallint DEFAULT 5 NOT NULL,
    enqueued_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    claimed_by text,
    completed_at timestamp with time zone,
    attempts smallint DEFAULT 0 NOT NULL,
    last_error text
);


--
-- Name: claim_reconcile_tasks(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_reconcile_tasks(p_worker text, p_limit integer) RETURNS SETOF public.reconcile_tasks
    LANGUAGE sql
    AS $$
  update reconcile_tasks
  set claimed_at = now(), claimed_by = p_worker
  where id in (
    select id from reconcile_tasks
    where claimed_at is null and completed_at is null
    order by priority, enqueued_at
    limit p_limit
    for update skip locked
  )
  returning *;
$$;


--
-- Name: effective_available_stock(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.effective_available_stock(p_item_id text, p_warehouse_id text) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT GREATEST(
    COALESCE((SELECT actual_available_for_sale_stock
              FROM zoho_item_warehouse_stock
              WHERE item_id = p_item_id AND warehouse_id = p_warehouse_id), 0)
    -
    COALESCE((SELECT SUM(qty) FROM inventory_reservations
              WHERE item_id = p_item_id AND warehouse_id = p_warehouse_id
                AND released_at IS NULL), 0),
    0
  )::integer;
$$;


--
-- Name: log_order_event(text, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_order_event(p_order_uid text, p_actor text, p_kind text, p_from text, p_to text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS text
    LANGUAGE sql
    AS $$
  INSERT INTO order_events (order_uid, actor, kind, from_state, to_state, payload)
  VALUES (p_order_uid, p_actor, p_kind, p_from, p_to, p_payload)
  RETURNING id;
$$;


--
-- Name: order_fulfillment_options(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.order_fulfillment_options(p_order_uid text) RETURNS TABLE(warehouse_id text, warehouse_name text, can_fulfill boolean, blockers jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  o orders%ROWTYPE;
  wh record;
  line jsonb;
  item_id_val text;
  li_sku text;
  li_qty int;
  effective int;
  wh_blockers jsonb;
BEGIN
  SELECT * INTO o FROM orders WHERE uid = p_order_uid;
  IF NOT FOUND THEN RETURN; END IF;

  -- Only sellable warehouses are ever fulfillment targets. Quarantine,
  -- damage, and photoshoot buckets never ship orders.
  FOR wh IN
    SELECT w.warehouse_id, w.warehouse_name FROM zoho_warehouses w
    WHERE w.warehouse_name IN ('SMSA Fulfillment KSA', 'Omniastores LLC')
  LOOP
    wh_blockers := '[]'::jsonb;
    FOR line IN SELECT * FROM jsonb_array_elements(o.line_items) LOOP
      li_sku := trim(line->>'sku');
      li_qty := COALESCE((line->>'qty')::int, 1);
      IF li_sku = '' OR li_qty <= 0 THEN CONTINUE; END IF;

      SELECT item_id INTO item_id_val FROM zoho_items WHERE sku = li_sku LIMIT 1;
      IF item_id_val IS NULL THEN
        wh_blockers := wh_blockers || jsonb_build_object(
          'sku', li_sku, 'reason', 'not in Zoho catalog');
        CONTINUE;
      END IF;

      -- effective = Zoho sellable minus local reservations. If you haven't
      -- created the reservations table yet, this falls through to just
      -- reading Zoho directly, which is fine — just gate the CTE:
      effective := COALESCE((
        SELECT ws.actual_available_for_sale_stock
        FROM zoho_item_warehouse_stock ws
        WHERE ws.item_id = item_id_val AND ws.warehouse_id = wh.warehouse_id
      ), 0)
      -
      COALESCE((
        SELECT SUM(r.qty)::int
        FROM inventory_reservations r
        WHERE r.item_id = item_id_val
          AND r.warehouse_id = wh.warehouse_id
          AND r.released_at IS NULL
          AND r.order_uid != p_order_uid
      ), 0);

      IF effective < li_qty THEN
        wh_blockers := wh_blockers || jsonb_build_object(
          'sku', li_sku, 'need', li_qty, 'have', GREATEST(effective, 0),
          'reason', 'insufficient stock');
      END IF;
    END LOOP;

    warehouse_id := wh.warehouse_id;
    warehouse_name := wh.warehouse_name;
    can_fulfill := (jsonb_array_length(wh_blockers) = 0);
    blockers := wh_blockers;
    RETURN NEXT;
  END LOOP;
END;
$$;


--
-- Name: orders_fulfillable_from_warehouse(text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orders_fulfillable_from_warehouse(p_warehouse_id text, p_mode text DEFAULT 'all'::text, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(order_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  WITH order_skus AS (
    SELECT
      oi.order_id,
      oi.sku,
      EXISTS (
        SELECT 1
        FROM zoho_items zi
        JOIN zoho_item_warehouse_stock ws ON ws.item_id = zi.item_id
        WHERE zi.sku = oi.sku
          AND ws.warehouse_id = p_warehouse_id
          AND ws.actual_available_for_sale_stock > 0
      ) AS has_stock
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id       -- adjust if PK is `id`
    WHERE oi.sku IS NOT NULL AND oi.sku <> ''
      AND (p_since IS NULL OR o.created_at >= p_since)
  )
  SELECT os.order_id
  FROM order_skus os
  GROUP BY os.order_id
  HAVING
    CASE
      WHEN p_mode = 'all' THEN bool_and(os.has_stock)
      ELSE bool_or(os.has_stock)
    END;
END;
$$;


--
-- Name: release_order_reservations(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_order_reservations(p_order_uid text, p_reason text) RETURNS integer
    LANGUAGE sql
    AS $$
  WITH updated AS (
    UPDATE inventory_reservations
    SET released_at = now(), release_reason = p_reason
    WHERE order_uid = p_order_uid AND released_at IS NULL
    RETURNING 1
  ) SELECT COUNT(*)::int FROM updated;
$$;


--
-- Name: reserve_order_from_warehouse(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reserve_order_from_warehouse(p_order_uid text, p_warehouse_id text, p_reserved_by text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  o orders%ROWTYPE;
  wh_name text;
  line jsonb;
  item_id_val text;
  li_sku text;  li_qty int;  effective int;
  failures jsonb := '[]'::jsonb;
  reservations jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO o FROM orders WHERE uid = p_order_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'order not found'); END IF;

  IF COALESCE(o.fulfillment_stage,'new') NOT IN ('new','processing','confirmed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not reservable', 'stage', o.fulfillment_stage);
  END IF;

  SELECT warehouse_name INTO wh_name FROM zoho_warehouses WHERE warehouse_id = p_warehouse_id;
  IF wh_name IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown warehouse'); END IF;

  -- Pass 1: verify every line
  FOR line IN SELECT * FROM jsonb_array_elements(o.line_items) LOOP
    li_sku := trim(line->>'sku');
    li_qty := (line->>'qty')::int;
    IF li_sku = '' OR li_qty <= 0 THEN CONTINUE; END IF;

    SELECT item_id INTO item_id_val FROM zoho_items WHERE sku = li_sku LIMIT 1;
    IF item_id_val IS NULL THEN
      failures := failures || jsonb_build_object('sku', li_sku, 'reason', 'not in zoho catalog');
      CONTINUE;
    END IF;

    effective := effective_available_stock(item_id_val, p_warehouse_id);
    IF effective < li_qty THEN
      failures := failures || jsonb_build_object(
        'sku', li_sku, 'need', li_qty, 'have', effective, 'reason', 'insufficient');
    END IF;
  END LOOP;

  IF jsonb_array_length(failures) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot fulfill', 'failures', failures);
  END IF;

  -- Pass 2: actually reserve. Pass 1 guaranteed success.
  FOR line IN SELECT * FROM jsonb_array_elements(o.line_items) LOOP
    li_sku := trim(line->>'sku');
    li_qty := (line->>'qty')::int;
    IF li_sku = '' OR li_qty <= 0 THEN CONTINUE; END IF;

    SELECT item_id INTO item_id_val FROM zoho_items WHERE sku = li_sku LIMIT 1;

    INSERT INTO inventory_reservations
      (tenant_id, order_uid, order_number, item_id, sku, warehouse_id, warehouse_name, qty, reserved_by)
    VALUES
      (o.tenant_id, o.uid, o.order_number, item_id_val, li_sku, p_warehouse_id, wh_name, li_qty, p_reserved_by)
    ON CONFLICT (order_uid, sku, warehouse_id) DO UPDATE
      SET qty = EXCLUDED.qty, released_at = NULL, release_reason = NULL, reserved_at = now();

    reservations := reservations || jsonb_build_object('sku', li_sku, 'qty', li_qty);
  END LOOP;

  UPDATE orders SET
    fulfillment_stage = 'reserved',
    fulfillment_stage_updated_at = now(),
    fulfillment_stage_updated_by = p_reserved_by
  WHERE uid = p_order_uid;

  RETURN jsonb_build_object('ok', true,
    'warehouse_id', p_warehouse_id, 'warehouse_name', wh_name, 'reservations', reservations);
END;
$$;


--
-- Name: try_consume_token(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.try_consume_token(p_channel text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
declare
  v channel_buckets%rowtype;
  v_elapsed numeric;
  v_refilled int;
begin
  select * into v from channel_buckets where channel = p_channel for update;
  if not found then return false; end if;

  v_elapsed := extract(epoch from (now() - v.last_refill));
  v_refilled := least(v.max_tokens, v.tokens + floor(v_elapsed * v.refill_per_sec)::int);

  if v_refilled < 1 then
    update channel_buckets set tokens = v_refilled, last_refill = now()
      where channel = p_channel;
    return false;
  end if;

  update channel_buckets set tokens = v_refilled - 1, last_refill = now()
    where channel = p_channel;
  return true;
end;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: warehouse_matrix_kpis_per_storefront(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.warehouse_matrix_kpis_per_storefront() RETURNS TABLE(store_id text, skus_listed bigint, total_listed_units numeric)
    LANGUAGE sql STABLE
    AS $$
  select store_id,
    count(distinct sku) as skus_listed,
    coalesce(sum(quantity), 0) as total_listed_units
  from store_inventory
  where quantity is not null
  group by store_id;
$$;


--
-- Name: warehouse_matrix_kpis_per_warehouse(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.warehouse_matrix_kpis_per_warehouse() RETURNS TABLE(warehouse_id text, warehouse_name text, skus_with_stock bigint, total_units numeric, total_sellable_units numeric)
    LANGUAGE sql STABLE
    AS $$
  select w.warehouse_id, w.warehouse_name,
    count(*) filter (where s.stock_on_hand > 0) as skus_with_stock,
    coalesce(sum(s.stock_on_hand), 0) as total_units,
    coalesce(sum(s.actual_available_for_sale_stock), 0) as total_sellable_units
  from zoho_warehouses w
  left join zoho_item_warehouse_stock s using (warehouse_id)
  group by w.warehouse_id, w.warehouse_name;
$$;


--
-- Name: zoho_consume_quota(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.zoho_consume_quota(p_limit integer, p_label text DEFAULT 'unlabelled'::text) RETURNS TABLE(allowed boolean, used integer)
    LANGUAGE plpgsql
    AS $$
declare
  v_count integer;
begin
  insert into zoho_api_usage (usage_date, request_count, updated_at)
  values (current_date, 1, now())
  on conflict (usage_date)
  do update set request_count = zoho_api_usage.request_count + 1,
                updated_at = now()
  returning zoho_api_usage.request_count into v_count;

  if v_count > p_limit then
    update zoho_api_usage
      set request_count = zoho_api_usage.request_count - 1
      where zoho_api_usage.usage_date = current_date;
    return query select false, v_count - 1;
  end if;

  -- Only count what was actually granted, so the per-label rows always sum
  -- to the day's total rather than to the attempts.
  insert into zoho_api_usage_labels (usage_date, label, request_count, updated_at)
  values (current_date, coalesce(nullif(p_label, ''), 'unlabelled'), 1, now())
  on conflict (usage_date, label)
  do update set request_count = zoho_api_usage_labels.request_count + 1,
                updated_at = now();

  return query select true, v_count;
end;
$$;


--
-- Name: zoho_consume_quota_org(text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.zoho_consume_quota_org(p_org text, p_limit integer, p_label text DEFAULT 'unlabelled'::text) RETURNS TABLE(allowed boolean, used integer)
    LANGUAGE plpgsql
    AS $$
declare
  v_count integer;
begin
  insert into zoho_api_usage_org (usage_date, org_id, request_count, updated_at)
  values (current_date, p_org, 1, now())
  on conflict (usage_date, org_id)
  do update set request_count = zoho_api_usage_org.request_count + 1, updated_at = now()
  returning zoho_api_usage_org.request_count into v_count;

  if v_count > p_limit then
    update zoho_api_usage_org set request_count = zoho_api_usage_org.request_count - 1
      where usage_date = current_date and org_id = p_org;
    return query select false, v_count - 1;
    return;
  end if;

  insert into zoho_api_usage_labels (usage_date, label, request_count, updated_at)
  values (current_date, p_org || ':' || p_label, 1, now())
  on conflict (usage_date, label)
  do update set request_count = zoho_api_usage_labels.request_count + 1, updated_at = now();

  return query select true, v_count;
end;
$$;


--
-- Name: ad_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_campaigns (
    id text NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    platform text NOT NULL,
    account_id text NOT NULL,
    store_id text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'unknown'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ad_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_insights (
    id text NOT NULL,
    campaign_id text NOT NULL,
    date date NOT NULL,
    spend numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'AED'::text NOT NULL,
    impressions integer DEFAULT 0 NOT NULL,
    clicks integer DEFAULT 0 NOT NULL,
    conversions numeric DEFAULT 0 NOT NULL,
    conversion_value numeric DEFAULT 0 NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    landing_page_views integer DEFAULT 0 NOT NULL,
    view_content integer DEFAULT 0 NOT NULL,
    add_to_cart integer DEFAULT 0 NOT NULL,
    initiate_checkout integer DEFAULT 0 NOT NULL
);


--
-- Name: ad_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    trigger text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    platform_results jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    entity text NOT NULL,
    entity_id text NOT NULL,
    event text NOT NULL,
    actor_id text,
    payload jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: bank_line_zoho_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_line_zoho_status (
    bank_line_id text NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    state text NOT NULL,
    match_kind text,
    zoho_transaction_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    zoho_reference text,
    zoho_amount numeric,
    zoho_type text,
    zoho_account text,
    zoho_status text,
    zoho_date date,
    checked_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bank_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_lines (
    id text NOT NULL,
    tenant_id text NOT NULL,
    statement_date timestamp(3) without time zone NOT NULL,
    value_date timestamp(3) without time zone,
    description text NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency text NOT NULL,
    gateway_guess text,
    matched_payout_id text,
    status text DEFAULT 'unmatched'::text NOT NULL,
    reference text DEFAULT ''::text NOT NULL,
    direction text DEFAULT 'credit'::text NOT NULL,
    confidence text,
    kind text,
    batch_id text,
    dedupe_key text,
    zoho_description text
);


--
-- Name: channel_buckets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_buckets (
    channel text NOT NULL,
    tokens integer NOT NULL,
    max_tokens integer NOT NULL,
    refill_per_sec integer NOT NULL,
    last_refill timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id text NOT NULL,
    tenant_id text NOT NULL,
    email text,
    phone text,
    name text NOT NULL,
    country text,
    city text,
    shopify_ids text[],
    woo_ids text[],
    first_order_date timestamp(3) without time zone,
    total_orders integer DEFAULT 0 NOT NULL,
    total_returns integer DEFAULT 0 NOT NULL,
    flag_score integer DEFAULT 0 NOT NULL,
    matched_by text DEFAULT ''::text NOT NULL,
    stores text[] DEFAULT '{}'::text[] NOT NULL,
    total_spend_aed numeric DEFAULT 0 NOT NULL,
    aov_aed numeric DEFAULT 0 NOT NULL,
    last_order_date timestamp with time zone,
    expected_ltv_next_year numeric DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: exchanges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchanges (
    id text NOT NULL,
    tenant_id text NOT NULL,
    return_id text NOT NULL,
    original_item_id text NOT NULL,
    replacement_sku text NOT NULL,
    replacement_name text NOT NULL,
    price_delta_aed numeric(12,2) NOT NULL,
    delta_status text DEFAULT 'pending'::text NOT NULL,
    mode public."ExchangeMode" DEFAULT 'RECEIVE_FIRST'::public."ExchangeMode" NOT NULL
);


--
-- Name: fee_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_rates (
    id text NOT NULL,
    tenant_id text NOT NULL,
    gateway text NOT NULL,
    currency text NOT NULL,
    store_id text NOT NULL,
    effective_rate numeric(6,4) NOT NULL,
    sample_size integer NOT NULL,
    period text NOT NULL
);


--
-- Name: forecasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forecasts (
    id text NOT NULL,
    tenant_id text NOT NULL,
    metric text NOT NULL,
    store_id text,
    gateway text,
    period_start timestamp(3) without time zone NOT NULL,
    period_end timestamp(3) without time zone NOT NULL,
    granularity text NOT NULL,
    predicted numeric(14,2) NOT NULL,
    lower_bound numeric(14,2) NOT NULL,
    upper_bound numeric(14,2) NOT NULL,
    actual numeric(14,2),
    model_version text NOT NULL
);


--
-- Name: gateway_pending_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gateway_pending_charges (
    id text NOT NULL,
    store text NOT NULL,
    gateway text NOT NULL,
    order_ref text NOT NULL,
    order_gid text,
    type text NOT NULL,
    transaction_date timestamp with time zone,
    currency text NOT NULL,
    gross_original numeric NOT NULL,
    fee_original numeric NOT NULL,
    net_original numeric NOT NULL,
    gross_aed numeric NOT NULL,
    fee_aed numeric NOT NULL,
    net_aed numeric NOT NULL,
    payout_status text,
    synced_at timestamp with time zone DEFAULT now()
);


--
-- Name: group_daily_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_daily_summaries (
    date_iso_day text NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    message_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_members (
    user_id bigint NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    username text DEFAULT ''::text NOT NULL,
    display_name text DEFAULT ''::text NOT NULL,
    role_description text DEFAULT ''::text NOT NULL,
    awaiting_role boolean DEFAULT false NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: group_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_messages (
    id bigint NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    chat_id text NOT NULL,
    user_id bigint,
    username text DEFAULT ''::text NOT NULL,
    text text DEFAULT ''::text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: group_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.group_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: group_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.group_messages_id_seq OWNED BY public.group_messages.id;


--
-- Name: insight_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insight_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    window_days integer DEFAULT 30 NOT NULL,
    store text DEFAULT 'All'::text NOT NULL,
    facts jsonb DEFAULT '[]'::jsonb NOT NULL,
    cards jsonb DEFAULT '[]'::jsonb NOT NULL,
    model text DEFAULT ''::text NOT NULL
);


--
-- Name: inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory (
    id text NOT NULL,
    tenant_id text NOT NULL,
    store_id text NOT NULL,
    product_id text NOT NULL,
    warehouse_id text NOT NULL,
    available_qty integer DEFAULT 0 NOT NULL
);


--
-- Name: inventory_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_reservations (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    tenant_id text NOT NULL,
    order_uid text NOT NULL,
    order_number text NOT NULL,
    item_id text NOT NULL,
    sku text NOT NULL,
    warehouse_id text NOT NULL,
    warehouse_name text NOT NULL,
    qty integer NOT NULL,
    reserved_at timestamp with time zone DEFAULT now() NOT NULL,
    reserved_by text NOT NULL,
    released_at timestamp with time zone,
    release_reason text,
    CONSTRAINT inventory_reservations_qty_check CHECK ((qty > 0))
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name text NOT NULL,
    whatsapp text NOT NULL,
    email text NOT NULL,
    store_url text DEFAULT ''::text NOT NULL,
    gateways text[] DEFAULT '{}'::text[] NOT NULL,
    monthly_orders text DEFAULT ''::text NOT NULL,
    accounting_tool text DEFAULT ''::text NOT NULL,
    utm_source text DEFAULT ''::text NOT NULL,
    utm_medium text DEFAULT ''::text NOT NULL,
    utm_campaign text DEFAULT ''::text NOT NULL,
    utm_content text DEFAULT ''::text NOT NULL,
    fbc text DEFAULT ''::text NOT NULL,
    fbp text DEFAULT ''::text NOT NULL,
    referrer text DEFAULT ''::text NOT NULL,
    landing_path text DEFAULT ''::text NOT NULL,
    event_id text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    user_agent text DEFAULT ''::text NOT NULL,
    source text DEFAULT 'ramza-landing'::text NOT NULL,
    company text DEFAULT ''::text NOT NULL,
    situation text DEFAULT ''::text NOT NULL,
    penalty_type text DEFAULT ''::text NOT NULL,
    penalty_issued_on date,
    checker jsonb
);


--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_entries (
    id text NOT NULL,
    tenant_id text NOT NULL,
    date timestamp(3) without time zone NOT NULL,
    type text NOT NULL,
    reference text NOT NULL,
    debit numeric(12,2) DEFAULT 0 NOT NULL,
    credit numeric(12,2) DEFAULT 0 NOT NULL
);


--
-- Name: order_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_attachments (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    order_uid text NOT NULL,
    kind text NOT NULL,
    provider text,
    external_ref text,
    url text NOT NULL,
    bytes integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text DEFAULT 'system'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: order_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_events (
    id text NOT NULL,
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    event text NOT NULL,
    detail jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    actor text DEFAULT 'system'::text NOT NULL,
    kind text NOT NULL,
    from_state text,
    to_state text,
    payload jsonb DEFAULT '{}'::jsonb,
    order_uid text
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id text NOT NULL,
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    sku text NOT NULL,
    product_name text NOT NULL,
    qty integer NOT NULL,
    unit_price_aed numeric(12,2) NOT NULL,
    line_total_aed numeric(12,2) NOT NULL
);


--
-- Name: order_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    trigger text DEFAULT 'scheduler'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    store_results jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id text DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text NOT NULL,
    uid text NOT NULL,
    store_id text NOT NULL,
    order_id text NOT NULL,
    order_number text NOT NULL,
    order_date timestamp(3) without time zone NOT NULL,
    customer_id text,
    currency text NOT NULL,
    gross_original numeric(12,2) NOT NULL,
    gross_aed numeric(12,2) NOT NULL,
    subtotal_aed numeric(12,2) NOT NULL,
    shipping_aed numeric(12,2) NOT NULL,
    tax_aed numeric(12,2) NOT NULL,
    discount_aed numeric(12,2) NOT NULL,
    gateway text NOT NULL,
    telr_cartid text,
    telr_tranref text,
    financial_status text NOT NULL,
    fulfillment_status text NOT NULL,
    source text NOT NULL,
    city text,
    country text,
    courier text,
    dispatch_date timestamp(3) without time zone,
    dispatch_lane text,
    fee_deducted numeric(12,2),
    gateway_raw text,
    net_received numeric(12,2),
    payment_received_date timestamp(3) without time zone,
    payout_id text,
    payout_status text,
    refunded_amount numeric(12,2),
    return_note text,
    return_status text,
    shipment_status text,
    total_outstanding numeric(12,2),
    tracking_number text,
    created_at timestamp(3) without time zone DEFAULT now() NOT NULL,
    customer_email text,
    customer_name text,
    customer_phone text,
    updated_at timestamp(3) without time zone DEFAULT now() NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    tracking_url text DEFAULT ''::text NOT NULL,
    fulfillment_stage text DEFAULT 'processing'::text NOT NULL,
    fulfillment_stage_updated_at timestamp with time zone,
    fulfillment_stage_updated_by text DEFAULT ''::text NOT NULL,
    awb_number text DEFAULT ''::text NOT NULL,
    shipped_at timestamp with time zone,
    label_url text DEFAULT ''::text NOT NULL,
    ship_error text DEFAULT ''::text NOT NULL,
    shipping_address1 text,
    shipping_address2 text,
    shipping_state text,
    shipping_postcode text,
    shipping_company text,
    billing_address1 text,
    billing_address2 text,
    billing_state text,
    billing_postcode text,
    billing_company text,
    stock_coverage_status text,
    stock_coverage_uae boolean,
    stock_coverage_ksa boolean
);


--
-- Name: payment_sheet_months; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_sheet_months (
    month_key text NOT NULL,
    spreadsheet_id text NOT NULL,
    label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payout_email_ingests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_email_ingests (
    id uuid NOT NULL,
    tenant_id text NOT NULL,
    message_id text NOT NULL,
    mailbox text NOT NULL,
    sender text,
    subject text,
    received_at timestamp with time zone,
    provider text,
    attachment_name text,
    payout_id text,
    status text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: payout_ref_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_ref_links (
    payout_id text NOT NULL,
    order_ref text NOT NULL,
    order_number text NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    linked_by text DEFAULT 'founder'::text NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payout_reverts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_reverts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    bank_line_id text NOT NULL,
    payout_id text NOT NULL,
    payout_source text,
    reason text DEFAULT ''::text NOT NULL,
    deleted_docs jsonb DEFAULT '[]'::jsonb NOT NULL,
    failed_docs jsonb DEFAULT '[]'::jsonb NOT NULL,
    reverted_by text DEFAULT ''::text NOT NULL,
    reverted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payout_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_transactions (
    id text NOT NULL,
    tenant_id text NOT NULL,
    payout_id text NOT NULL,
    order_ref text NOT NULL,
    matched_order_id text,
    gross_aed numeric(12,2) NOT NULL,
    fee_aed numeric(12,2) NOT NULL,
    net_aed numeric(12,2) NOT NULL,
    is_refund boolean DEFAULT false NOT NULL,
    quality text,
    gross_original numeric,
    fee_original numeric,
    net_original numeric,
    vat_aed numeric,
    vat_original numeric
);


--
-- Name: payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payouts (
    id text NOT NULL,
    tenant_id text NOT NULL,
    gateway text NOT NULL,
    payout_id text NOT NULL,
    payout_date timestamp(3) without time zone,
    currency text NOT NULL,
    gross_amount numeric(12,2) NOT NULL,
    fee_amount numeric(12,2) NOT NULL,
    net_amount numeric(12,2) NOT NULL,
    txn_count integer NOT NULL,
    bank_line_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    source text,
    original_currency text,
    net_original numeric,
    uploaded_at timestamp with time zone DEFAULT now(),
    store text,
    merchant_code text,
    statement_no text,
    delivery_charges jsonb,
    delivery_charge_entities jsonb,
    delivery_postings jsonb,
    zoho_connection_id text DEFAULT ''::text NOT NULL
);


--
-- Name: pending_zoho_sync; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_zoho_sync (
    sku text NOT NULL,
    origin_channel text NOT NULL,
    expected_delta integer NOT NULL,
    order_ref text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cleared_at timestamp with time zone,
    cleared_by text
);


--
-- Name: pilot_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pilot_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    company text NOT NULL,
    role text DEFAULT ''::text NOT NULL,
    ecom_platform text DEFAULT ''::text NOT NULL,
    accounting text DEFAULT ''::text NOT NULL,
    monthly_orders text DEFAULT ''::text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    source text DEFAULT 'recon-copilot-landing'::text NOT NULL,
    utm jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    user_agent text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profit_share_payees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profit_share_payees (
    normalized_name text NOT NULL,
    display_name text NOT NULL,
    equity_account_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: purchase_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_order_items (
    id text NOT NULL,
    purchase_order_id text NOT NULL,
    sku text NOT NULL,
    qty integer NOT NULL,
    unit_cost_aed numeric(12,2) NOT NULL
);


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id text NOT NULL,
    tenant_id text NOT NULL,
    store_id text NOT NULL,
    supplier_id text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL
);


--
-- Name: recon_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recon_lines (
    id text NOT NULL,
    tenant_id text NOT NULL,
    gateway text NOT NULL,
    payout_id text,
    bank_line_id text,
    expected_net numeric(12,2),
    bank_net numeric(12,2) NOT NULL,
    delta numeric(12,2) NOT NULL,
    match_status text NOT NULL,
    reconciled_at timestamp(3) without time zone,
    resolved_orders text[] DEFAULT '{}'::text[] NOT NULL,
    unresolved_refs text[] DEFAULT '{}'::text[] NOT NULL,
    confirmed_by text,
    confirmed_at timestamp with time zone,
    refunded_orders text[] DEFAULT '{}'::text[] NOT NULL,
    quality_issues jsonb DEFAULT '[]'::jsonb NOT NULL,
    review_flag boolean DEFAULT false NOT NULL,
    review_note text DEFAULT ''::text NOT NULL,
    force_booked_by text,
    force_booked_at timestamp with time zone,
    force_note text DEFAULT ''::text NOT NULL,
    force_residual_account_id text,
    force_residual_account_name text
);


--
-- Name: recon_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recon_snapshots (
    id text NOT NULL,
    payload jsonb NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    duration_ms integer,
    dirty boolean DEFAULT false NOT NULL,
    dirty_at timestamp with time zone
);


--
-- Name: reconcile_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reconcile_tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reconcile_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reconcile_tasks_id_seq OWNED BY public.reconcile_tasks.id;


--
-- Name: refund_postings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refund_postings (
    id text NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    bank_line_id text NOT NULL,
    payout_id text NOT NULL,
    order_number text NOT NULL,
    amount_aed numeric NOT NULL,
    zoho_invoice_id text,
    zoho_creditnote_id text,
    creditnote_reused boolean DEFAULT false NOT NULL,
    zoho_refund_id text,
    error text,
    claimed_at timestamp with time zone,
    posted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    charge_amount_aed numeric,
    zoho_charge_id text,
    charge_kind text
);


--
-- Name: refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refunds (
    id text NOT NULL,
    tenant_id text NOT NULL,
    return_id text NOT NULL,
    order_id text NOT NULL,
    amount_aed numeric(12,2) NOT NULL,
    currency text NOT NULL,
    amount_original numeric(12,2) NOT NULL,
    gateway text NOT NULL,
    gateway_refund_ref text,
    status text DEFAULT 'pending'::text NOT NULL,
    recon_line_id text,
    fee_aed numeric(12,2) DEFAULT 0 NOT NULL
);


--
-- Name: return_shipments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.return_shipments (
    id text NOT NULL,
    tenant_id text NOT NULL,
    return_id text NOT NULL,
    courier public."Courier" NOT NULL,
    waybill text,
    direction text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    tracking_url text
);


--
-- Name: returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.returns (
    id text NOT NULL,
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    customer_id text NOT NULL,
    type public."ReturnType" NOT NULL,
    reason text NOT NULL,
    status public."ReturnStatus" DEFAULT 'REQUESTED'::public."ReturnStatus" NOT NULL,
    scope public."ReturnScope" DEFAULT 'LOCAL'::public."ReturnScope" NOT NULL,
    channel text NOT NULL,
    agent_id text,
    requested_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at timestamp(3) without time zone,
    condition public."ItemCondition" DEFAULT 'UNSPECIFIED'::public."ItemCondition" NOT NULL,
    condition_deduction_aed numeric(12,2)
);


--
-- Name: settlement_document_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_document_links (
    settlement_document_id uuid NOT NULL,
    settlement_record_id text NOT NULL
);


--
-- Name: settlement_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    uploaded_file_id uuid NOT NULL,
    confirm_token text NOT NULL,
    confirmed_by text,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: settlement_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_records (
    id text NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    order_uid text NOT NULL,
    order_number text NOT NULL,
    store_id text NOT NULL,
    customer_name text DEFAULT ''::text NOT NULL,
    customer_email text DEFAULT ''::text NOT NULL,
    order_date timestamp with time zone,
    settlement_date date,
    gateway text NOT NULL,
    currency text DEFAULT 'AED'::text NOT NULL,
    gross_aed numeric DEFAULT 0 NOT NULL,
    bank_line_id text NOT NULL,
    payout_id text,
    bank_reference text DEFAULT ''::text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence_type text,
    evidence_confirmed boolean DEFAULT false NOT NULL,
    evidence_confirmed_by text,
    evidence_confirmed_at timestamp with time zone,
    evidence_document_id uuid,
    zoho_payment_id text,
    zoho_published_at timestamp with time zone,
    zoho_claimed_at timestamp with time zone,
    zoho_invoice_id text,
    zoho_fee_expense_id text,
    zoho_fx_journal_id text,
    fee_aed numeric,
    fee_vat_aed numeric,
    fx_difference_aed numeric,
    zoho_post_error text,
    zoho_invoice_number text,
    zoho_invoice_status text,
    zoho_invoice_balance numeric(14,2),
    zoho_invoice_total numeric(14,2),
    zoho_invoice_checked_at timestamp with time zone,
    order_currency text,
    force_allocations jsonb,
    force_note text,
    force_by text,
    force_at timestamp with time zone,
    force_payment_id text,
    force_payment_amount numeric
);


--
-- Name: shopify_variant_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shopify_variant_map (
    store_id text NOT NULL,
    variant_id text NOT NULL,
    sku text NOT NULL,
    inventory_item_id text NOT NULL,
    location_id text NOT NULL,
    product_status text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    location_name text,
    is_readonly boolean DEFAULT false NOT NULL,
    fulfillment_service text
);


--
-- Name: stock_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_alerts (
    id bigint NOT NULL,
    sku text NOT NULL,
    kind text NOT NULL,
    detail jsonb,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by text
);


--
-- Name: stock_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_alerts_id_seq OWNED BY public.stock_alerts.id;


--
-- Name: stock_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_events (
    id bigint NOT NULL,
    sku text NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    delta integer,
    new_qty integer,
    correlation text,
    occurred_at timestamp with time zone NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    raw jsonb,
    CONSTRAINT stock_events_event_type_check CHECK ((event_type = ANY (ARRAY['order_decrement'::text, 'manual_adjust'::text, 'restock'::text, 'refund'::text, 'snapshot'::text, 'reconcile_push'::text, 'reconcile_correction'::text, 'webhook_reject'::text]))),
    CONSTRAINT stock_events_source_check CHECK ((source = ANY (ARRAY['zoho'::text, 'shopify_uae'::text, 'shopify_ksa'::text, 'shopify_wa'::text, 'woo'::text, 'master'::text, 'reconciler'::text])))
);


--
-- Name: stock_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_events_id_seq OWNED BY public.stock_events.id;


--
-- Name: stock_write_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_write_intents (
    id bigint NOT NULL,
    sku text NOT NULL,
    store_id text NOT NULL,
    from_qty integer,
    to_qty integer NOT NULL,
    write_mode text NOT NULL,
    action text NOT NULL,
    reason text,
    actor text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stock_write_intents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_write_intents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_write_intents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_write_intents_id_seq OWNED BY public.stock_write_intents.id;


--
-- Name: store_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_inventory (
    id text NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    store_id text NOT NULL,
    sku text NOT NULL,
    quantity numeric,
    product_title text DEFAULT ''::text NOT NULL,
    product_status text DEFAULT ''::text NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stores (
    id text NOT NULL,
    store_id text NOT NULL,
    platform text NOT NULL,
    domain text NOT NULL,
    currency text NOT NULL,
    timezone text NOT NULL
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    contact text,
    email text
);


--
-- Name: sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    trigger text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    gateway_results jsonb DEFAULT '[]'::jsonb NOT NULL,
    recon_summary jsonb,
    error text
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    title text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    source_ref text DEFAULT ''::text NOT NULL,
    assignee text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: telegram_poll_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_poll_state (
    bot text NOT NULL,
    last_update_id bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: uploaded_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uploaded_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    kind text NOT NULL,
    provider text,
    filename text NOT NULL,
    mime text,
    size_bytes integer,
    content_base64 text NOT NULL,
    parse_summary text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    id text NOT NULL,
    auth_id text NOT NULL,
    tenant_id text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    role public."Role" DEFAULT 'USER'::public."Role" NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: warehouse_stock_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouse_stock_events (
    sku text NOT NULL,
    warehouse_id text NOT NULL,
    delta numeric NOT NULL,
    prior_stock numeric NOT NULL,
    new_stock numeric NOT NULL,
    detected_at timestamp with time zone NOT NULL
);


--
-- Name: warehouses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouses (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    location text NOT NULL
);


--
-- Name: webhook_heartbeat; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_heartbeat (
    source text NOT NULL,
    topic text NOT NULL,
    last_seen timestamp with time zone NOT NULL,
    last_id text,
    count_1h integer DEFAULT 0 NOT NULL
);


--
-- Name: webhook_inbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_inbox (
    provider text NOT NULL,
    webhook_id text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: woo_product_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.woo_product_map (
    sku text NOT NULL,
    product_id integer NOT NULL,
    variation_id integer,
    parent_id integer,
    product_status text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: zoho_account_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_account_config (
    id text DEFAULT 'omnia'::text NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    bank_account_id text DEFAULT ''::text NOT NULL,
    fee_account_id text DEFAULT ''::text NOT NULL,
    clearing_by_gateway jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text DEFAULT ''::text NOT NULL,
    default_income_account_id text DEFAULT ''::text NOT NULL,
    expense_account_by_kind jsonb DEFAULT '{}'::jsonb NOT NULL,
    zoho_connection_id text DEFAULT ''::text NOT NULL
);


--
-- Name: zoho_action_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_action_log (
    id bigint NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor text DEFAULT ''::text NOT NULL,
    connection_id text DEFAULT 'env'::text NOT NULL,
    org_id text DEFAULT ''::text NOT NULL,
    entity text NOT NULL,
    action text NOT NULL,
    record_id text DEFAULT ''::text NOT NULL,
    request jsonb,
    ok boolean DEFAULT false NOT NULL,
    http_status integer,
    zoho_code integer,
    message text DEFAULT ''::text NOT NULL
);


--
-- Name: zoho_action_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zoho_action_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: zoho_action_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.zoho_action_log_id_seq OWNED BY public.zoho_action_log.id;


--
-- Name: zoho_api_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_api_usage (
    usage_date date DEFAULT CURRENT_DATE NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: zoho_api_usage_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_api_usage_labels (
    usage_date date DEFAULT CURRENT_DATE NOT NULL,
    label text DEFAULT 'unlabelled'::text NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: zoho_api_usage_org; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_api_usage_org (
    usage_date date DEFAULT CURRENT_DATE NOT NULL,
    org_id text NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: zoho_bank_txn_postings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_bank_txn_postings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    bank_line_id text NOT NULL,
    direction text NOT NULL,
    transaction_type text DEFAULT ''::text NOT NULL,
    category_account_id text DEFAULT ''::text NOT NULL,
    reference_number text DEFAULT ''::text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    zoho_transaction_id text,
    status text DEFAULT 'posted'::text NOT NULL,
    error text DEFAULT ''::text NOT NULL,
    posted_by text DEFAULT ''::text NOT NULL,
    posted_at timestamp with time zone DEFAULT now() NOT NULL,
    verified_at timestamp with time zone,
    missing_in_zoho boolean DEFAULT false,
    zoho_status text
);


--
-- Name: zoho_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_connections (
    id text NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    label text NOT NULL,
    org_id text NOT NULL,
    org_name text DEFAULT ''::text NOT NULL,
    accounts_url text DEFAULT 'https://accounts.zoho.com'::text NOT NULL,
    api_domain text DEFAULT 'https://www.zohoapis.com'::text NOT NULL,
    client_id text NOT NULL,
    client_secret_enc text NOT NULL,
    refresh_token_enc text NOT NULL,
    login_email text DEFAULT ''::text NOT NULL,
    daily_budget integer DEFAULT 4500 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_checked_at timestamp with time zone,
    last_error text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    default_for_providers text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text DEFAULT ''::text NOT NULL
);


--
-- Name: zoho_item_warehouse_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_item_warehouse_stock (
    item_id text NOT NULL,
    sku text NOT NULL,
    warehouse_id text NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    stock_on_hand numeric DEFAULT 0 NOT NULL,
    available_stock numeric DEFAULT 0 NOT NULL,
    available_for_sale_stock numeric DEFAULT 0 NOT NULL,
    committed_stock numeric DEFAULT 0 NOT NULL,
    actual_available_stock numeric DEFAULT 0 NOT NULL,
    actual_committed_stock numeric DEFAULT 0 NOT NULL,
    actual_available_for_sale_stock numeric DEFAULT 0 NOT NULL,
    quantity_in_transit numeric DEFAULT 0 NOT NULL,
    is_item_mapped boolean DEFAULT false NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    last_modified_time timestamp with time zone,
    synced_at timestamp with time zone NOT NULL
);


--
-- Name: zoho_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_items (
    item_id text NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    sku text DEFAULT ''::text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    stock_on_hand numeric DEFAULT 0 NOT NULL,
    available_stock numeric DEFAULT 0 NOT NULL,
    rate numeric DEFAULT 0 NOT NULL,
    status text DEFAULT ''::text NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    purchase_rate numeric DEFAULT 0 NOT NULL
);


--
-- Name: zoho_ledger_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_ledger_lines (
    id text NOT NULL,
    month text NOT NULL,
    account_id text NOT NULL,
    account_name text DEFAULT ''::text NOT NULL,
    txn_date date,
    txn_type text DEFAULT ''::text NOT NULL,
    txn_type_label text DEFAULT ''::text NOT NULL,
    transaction_id text DEFAULT ''::text NOT NULL,
    entry_number text DEFAULT ''::text NOT NULL,
    reference_number text DEFAULT ''::text NOT NULL,
    payee text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    offset_account text DEFAULT ''::text NOT NULL,
    debit numeric(14,2) DEFAULT 0 NOT NULL,
    credit numeric(14,2) DEFAULT 0 NOT NULL,
    currency_code text DEFAULT 'AED'::text NOT NULL,
    reconcile_status text DEFAULT ''::text NOT NULL,
    run_id text DEFAULT ''::text NOT NULL
);


--
-- Name: zoho_ledger_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_ledger_snapshots (
    month text NOT NULL,
    status text DEFAULT 'idle'::text NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    api_calls integer DEFAULT 0 NOT NULL,
    line_count integer DEFAULT 0 NOT NULL,
    accounts jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text,
    requested_by text DEFAULT ''::text NOT NULL,
    open_credit_notes jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: zoho_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_orders (
    salesorder_id text NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    salesorder_number text DEFAULT ''::text NOT NULL,
    reference_number text DEFAULT ''::text NOT NULL,
    status text DEFAULT ''::text NOT NULL,
    order_status text DEFAULT ''::text NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    order_date date,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: zoho_postings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_postings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    bank_line_id text NOT NULL,
    gateway text NOT NULL,
    payout_id text,
    reference_number text DEFAULT ''::text NOT NULL,
    net_aed numeric DEFAULT 0 NOT NULL,
    gross_aed numeric DEFAULT 0 NOT NULL,
    fee_aed numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'posted'::text NOT NULL,
    zoho_result jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text DEFAULT ''::text NOT NULL,
    posted_by text DEFAULT ''::text NOT NULL,
    posted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: zoho_publish_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_publish_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    trigger text DEFAULT 'manual'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    results jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text
);


--
-- Name: zoho_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_records (
    connection_id text NOT NULL,
    entity text NOT NULL,
    record_id text NOT NULL,
    data jsonb NOT NULL,
    modified_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: zoho_sync_cursors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_sync_cursors (
    connection_id text NOT NULL,
    entity text NOT NULL,
    cursor timestamp with time zone,
    last_run_at timestamp with time zone,
    last_count integer DEFAULT 0 NOT NULL,
    last_error text DEFAULT ''::text NOT NULL
);


--
-- Name: zoho_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    trigger text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    source_results jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text,
    sync_mode text DEFAULT 'full'::text NOT NULL,
    watermark timestamp with time zone
);


--
-- Name: zoho_warehouses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_warehouses (
    warehouse_id text NOT NULL,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    warehouse_name text NOT NULL,
    status text,
    is_primary boolean DEFAULT false NOT NULL,
    is_fba_warehouse boolean DEFAULT false NOT NULL,
    address jsonb,
    synced_at timestamp with time zone NOT NULL,
    name text,
    region text,
    is_sellable boolean
);


--
-- Name: zoho_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoho_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed boolean DEFAULT false NOT NULL
);


--
-- Name: group_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_messages ALTER COLUMN id SET DEFAULT nextval('public.group_messages_id_seq'::regclass);


--
-- Name: reconcile_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconcile_tasks ALTER COLUMN id SET DEFAULT nextval('public.reconcile_tasks_id_seq'::regclass);


--
-- Name: stock_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_alerts ALTER COLUMN id SET DEFAULT nextval('public.stock_alerts_id_seq'::regclass);


--
-- Name: stock_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_events ALTER COLUMN id SET DEFAULT nextval('public.stock_events_id_seq'::regclass);


--
-- Name: stock_write_intents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_write_intents ALTER COLUMN id SET DEFAULT nextval('public.stock_write_intents_id_seq'::regclass);


--
-- Name: zoho_action_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_action_log ALTER COLUMN id SET DEFAULT nextval('public.zoho_action_log_id_seq'::regclass);


--
-- Name: ad_campaigns ad_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_campaigns
    ADD CONSTRAINT ad_campaigns_pkey PRIMARY KEY (id);


--
-- Name: ad_insights ad_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_insights
    ADD CONSTRAINT ad_insights_pkey PRIMARY KEY (id);


--
-- Name: ad_sync_runs ad_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_sync_runs
    ADD CONSTRAINT ad_sync_runs_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: bank_line_zoho_status bank_line_zoho_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_line_zoho_status
    ADD CONSTRAINT bank_line_zoho_status_pkey PRIMARY KEY (bank_line_id);


--
-- Name: bank_lines bank_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_lines
    ADD CONSTRAINT bank_lines_pkey PRIMARY KEY (id);


--
-- Name: channel_buckets channel_buckets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_buckets
    ADD CONSTRAINT channel_buckets_pkey PRIMARY KEY (channel);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: exchanges exchanges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchanges
    ADD CONSTRAINT exchanges_pkey PRIMARY KEY (id);


--
-- Name: fee_rates fee_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_rates
    ADD CONSTRAINT fee_rates_pkey PRIMARY KEY (id);


--
-- Name: forecasts forecasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forecasts
    ADD CONSTRAINT forecasts_pkey PRIMARY KEY (id);


--
-- Name: gateway_pending_charges gateway_pending_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_pending_charges
    ADD CONSTRAINT gateway_pending_charges_pkey PRIMARY KEY (id);


--
-- Name: group_daily_summaries group_daily_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_daily_summaries
    ADD CONSTRAINT group_daily_summaries_pkey PRIMARY KEY (date_iso_day);


--
-- Name: group_members group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_pkey PRIMARY KEY (user_id);


--
-- Name: group_messages group_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_messages
    ADD CONSTRAINT group_messages_pkey PRIMARY KEY (id);


--
-- Name: insight_runs insight_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insight_runs
    ADD CONSTRAINT insight_runs_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);


--
-- Name: inventory_reservations inventory_reservations_order_uid_sku_warehouse_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_order_uid_sku_warehouse_id_key UNIQUE (order_uid, sku, warehouse_id);


--
-- Name: inventory_reservations inventory_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: order_attachments order_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_attachments
    ADD CONSTRAINT order_attachments_pkey PRIMARY KEY (id);


--
-- Name: order_events order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_sync_runs order_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_sync_runs
    ADD CONSTRAINT order_sync_runs_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payment_sheet_months payment_sheet_months_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_sheet_months
    ADD CONSTRAINT payment_sheet_months_pkey PRIMARY KEY (month_key);


--
-- Name: payout_email_ingests payout_email_ingests_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_email_ingests
    ADD CONSTRAINT payout_email_ingests_message_id_key UNIQUE (message_id);


--
-- Name: payout_email_ingests payout_email_ingests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_email_ingests
    ADD CONSTRAINT payout_email_ingests_pkey PRIMARY KEY (id);


--
-- Name: payout_ref_links payout_ref_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_ref_links
    ADD CONSTRAINT payout_ref_links_pkey PRIMARY KEY (payout_id, order_ref);


--
-- Name: payout_reverts payout_reverts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_reverts
    ADD CONSTRAINT payout_reverts_pkey PRIMARY KEY (id);


--
-- Name: payout_transactions payout_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_transactions
    ADD CONSTRAINT payout_transactions_pkey PRIMARY KEY (id);


--
-- Name: payouts payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);


--
-- Name: pending_zoho_sync pending_zoho_sync_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_zoho_sync
    ADD CONSTRAINT pending_zoho_sync_pkey PRIMARY KEY (sku, origin_channel, order_ref);


--
-- Name: pilot_leads pilot_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pilot_leads
    ADD CONSTRAINT pilot_leads_pkey PRIMARY KEY (id);


--
-- Name: profit_share_payees profit_share_payees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_share_payees
    ADD CONSTRAINT profit_share_payees_pkey PRIMARY KEY (normalized_name);


--
-- Name: purchase_order_items purchase_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: recon_lines recon_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recon_lines
    ADD CONSTRAINT recon_lines_pkey PRIMARY KEY (id);


--
-- Name: recon_snapshots recon_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recon_snapshots
    ADD CONSTRAINT recon_snapshots_pkey PRIMARY KEY (id);


--
-- Name: reconcile_tasks reconcile_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconcile_tasks
    ADD CONSTRAINT reconcile_tasks_pkey PRIMARY KEY (id);


--
-- Name: refund_postings refund_postings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_postings
    ADD CONSTRAINT refund_postings_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: return_shipments return_shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_shipments
    ADD CONSTRAINT return_shipments_pkey PRIMARY KEY (id);


--
-- Name: returns returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_pkey PRIMARY KEY (id);


--
-- Name: settlement_document_links settlement_document_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_document_links
    ADD CONSTRAINT settlement_document_links_pkey PRIMARY KEY (settlement_document_id, settlement_record_id);


--
-- Name: settlement_documents settlement_documents_confirm_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_documents
    ADD CONSTRAINT settlement_documents_confirm_token_key UNIQUE (confirm_token);


--
-- Name: settlement_documents settlement_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_documents
    ADD CONSTRAINT settlement_documents_pkey PRIMARY KEY (id);


--
-- Name: settlement_records settlement_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_records
    ADD CONSTRAINT settlement_records_pkey PRIMARY KEY (id);


--
-- Name: shopify_variant_map shopify_variant_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopify_variant_map
    ADD CONSTRAINT shopify_variant_map_pkey PRIMARY KEY (store_id, variant_id);


--
-- Name: stock_alerts stock_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_alerts
    ADD CONSTRAINT stock_alerts_pkey PRIMARY KEY (id);


--
-- Name: stock_events stock_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_events
    ADD CONSTRAINT stock_events_pkey PRIMARY KEY (id);


--
-- Name: stock_write_intents stock_write_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_write_intents
    ADD CONSTRAINT stock_write_intents_pkey PRIMARY KEY (id);


--
-- Name: store_inventory store_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_inventory
    ADD CONSTRAINT store_inventory_pkey PRIMARY KEY (id);


--
-- Name: stores stores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: sync_runs sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: telegram_poll_state telegram_poll_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_poll_state
    ADD CONSTRAINT telegram_poll_state_pkey PRIMARY KEY (bot);


--
-- Name: uploaded_files uploaded_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_pkey PRIMARY KEY (id);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: warehouses warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);


--
-- Name: webhook_heartbeat webhook_heartbeat_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_heartbeat
    ADD CONSTRAINT webhook_heartbeat_pkey PRIMARY KEY (source, topic);


--
-- Name: webhook_inbox webhook_inbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_inbox
    ADD CONSTRAINT webhook_inbox_pkey PRIMARY KEY (provider, webhook_id);


--
-- Name: woo_product_map woo_product_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.woo_product_map
    ADD CONSTRAINT woo_product_map_pkey PRIMARY KEY (sku);


--
-- Name: zoho_account_config zoho_account_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_account_config
    ADD CONSTRAINT zoho_account_config_pkey PRIMARY KEY (id);


--
-- Name: zoho_action_log zoho_action_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_action_log
    ADD CONSTRAINT zoho_action_log_pkey PRIMARY KEY (id);


--
-- Name: zoho_api_usage_labels zoho_api_usage_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_api_usage_labels
    ADD CONSTRAINT zoho_api_usage_labels_pkey PRIMARY KEY (usage_date, label);


--
-- Name: zoho_api_usage_org zoho_api_usage_org_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_api_usage_org
    ADD CONSTRAINT zoho_api_usage_org_pkey PRIMARY KEY (usage_date, org_id);


--
-- Name: zoho_api_usage zoho_api_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_api_usage
    ADD CONSTRAINT zoho_api_usage_pkey PRIMARY KEY (usage_date);


--
-- Name: zoho_bank_txn_postings zoho_bank_txn_postings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_bank_txn_postings
    ADD CONSTRAINT zoho_bank_txn_postings_pkey PRIMARY KEY (id);


--
-- Name: zoho_connections zoho_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_connections
    ADD CONSTRAINT zoho_connections_pkey PRIMARY KEY (id);


--
-- Name: zoho_connections zoho_connections_tenant_id_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_connections
    ADD CONSTRAINT zoho_connections_tenant_id_org_id_key UNIQUE (tenant_id, org_id);


--
-- Name: zoho_item_warehouse_stock zoho_item_warehouse_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_item_warehouse_stock
    ADD CONSTRAINT zoho_item_warehouse_stock_pkey PRIMARY KEY (item_id, warehouse_id);


--
-- Name: zoho_items zoho_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_items
    ADD CONSTRAINT zoho_items_pkey PRIMARY KEY (item_id);


--
-- Name: zoho_ledger_lines zoho_ledger_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_ledger_lines
    ADD CONSTRAINT zoho_ledger_lines_pkey PRIMARY KEY (id);


--
-- Name: zoho_ledger_snapshots zoho_ledger_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_ledger_snapshots
    ADD CONSTRAINT zoho_ledger_snapshots_pkey PRIMARY KEY (month);


--
-- Name: zoho_orders zoho_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_orders
    ADD CONSTRAINT zoho_orders_pkey PRIMARY KEY (salesorder_id);


--
-- Name: zoho_postings zoho_postings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_postings
    ADD CONSTRAINT zoho_postings_pkey PRIMARY KEY (id);


--
-- Name: zoho_publish_runs zoho_publish_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_publish_runs
    ADD CONSTRAINT zoho_publish_runs_pkey PRIMARY KEY (id);


--
-- Name: zoho_records zoho_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_records
    ADD CONSTRAINT zoho_records_pkey PRIMARY KEY (connection_id, entity, record_id);


--
-- Name: zoho_sync_cursors zoho_sync_cursors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_sync_cursors
    ADD CONSTRAINT zoho_sync_cursors_pkey PRIMARY KEY (connection_id, entity);


--
-- Name: zoho_sync_runs zoho_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_sync_runs
    ADD CONSTRAINT zoho_sync_runs_pkey PRIMARY KEY (id);


--
-- Name: zoho_warehouses zoho_warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_warehouses
    ADD CONSTRAINT zoho_warehouses_pkey PRIMARY KEY (warehouse_id);


--
-- Name: zoho_webhook_events zoho_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_webhook_events
    ADD CONSTRAINT zoho_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: ad_campaigns_store_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ad_campaigns_store_idx ON public.ad_campaigns USING btree (store_id);


--
-- Name: ad_insights_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ad_insights_campaign_idx ON public.ad_insights USING btree (campaign_id);


--
-- Name: ad_insights_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ad_insights_date_idx ON public.ad_insights USING btree (date DESC);


--
-- Name: ad_sync_runs_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ad_sync_runs_started_idx ON public.ad_sync_runs USING btree (started_at DESC);


--
-- Name: audit_logs_entity_entity_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_entity_entity_id_idx ON public.audit_logs USING btree (entity, entity_id);


--
-- Name: bank_lines_dedupe_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bank_lines_dedupe_key_idx ON public.bank_lines USING btree (dedupe_key);


--
-- Name: customers_total_spend_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_total_spend_idx ON public.customers USING btree (total_spend_aed DESC);


--
-- Name: gateway_pending_charges_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gateway_pending_charges_order_idx ON public.gateway_pending_charges USING btree (order_ref);


--
-- Name: gateway_pending_charges_store_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gateway_pending_charges_store_idx ON public.gateway_pending_charges USING btree (store);


--
-- Name: group_messages_sent_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX group_messages_sent_at_idx ON public.group_messages USING btree (sent_at DESC);


--
-- Name: idx_attach_order_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attach_order_kind ON public.order_attachments USING btree (order_uid, kind, created_at DESC);


--
-- Name: idx_attachments_order_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachments_order_kind ON public.order_attachments USING btree (order_uid, kind, created_at DESC);


--
-- Name: idx_order_events_order_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_events_order_time ON public.order_events USING btree (order_uid, created_at DESC);


--
-- Name: idx_order_items_order_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_sku ON public.order_items USING btree (order_id, sku);


--
-- Name: idx_profit_share_payees_display; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profit_share_payees_display ON public.profit_share_payees USING btree (display_name);


--
-- Name: idx_res_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_res_active ON public.inventory_reservations USING btree (item_id, warehouse_id) WHERE (released_at IS NULL);


--
-- Name: idx_stock_write_intents_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_write_intents_created ON public.stock_write_intents USING btree (created_at DESC);


--
-- Name: idx_stock_write_intents_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_write_intents_sku ON public.stock_write_intents USING btree (sku);


--
-- Name: idx_ziws_warehouse_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ziws_warehouse_stock ON public.zoho_item_warehouse_stock USING btree (warehouse_id, actual_available_for_sale_stock) WHERE (actual_available_for_sale_stock > (0)::numeric);


--
-- Name: idx_zoho_items_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zoho_items_sku ON public.zoho_items USING btree (sku);


--
-- Name: insight_runs_generated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX insight_runs_generated_idx ON public.insight_runs USING btree (generated_at DESC);


--
-- Name: leads_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_created_idx ON public.leads USING btree (created_at DESC);


--
-- Name: leads_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_status_idx ON public.leads USING btree (status);


--
-- Name: ledger_entries_reference_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ledger_entries_reference_idx ON public.ledger_entries USING btree (reference);


--
-- Name: ledger_entries_type_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ledger_entries_type_date_idx ON public.ledger_entries USING btree (type, date);


--
-- Name: order_events_order_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_events_order_id_created_at_idx ON public.order_events USING btree (order_id, created_at);


--
-- Name: order_items_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_items_order_id_idx ON public.order_items USING btree (order_id);


--
-- Name: order_sync_runs_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_sync_runs_started_idx ON public.order_sync_runs USING btree (started_at DESC);


--
-- Name: orders_city_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_city_trgm_idx ON public.orders USING gin (city public.gin_trgm_ops);


--
-- Name: orders_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_customer_id_idx ON public.orders USING btree (customer_id);


--
-- Name: orders_customer_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_customer_name_trgm_idx ON public.orders USING gin (customer_name public.gin_trgm_ops);


--
-- Name: orders_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_date_idx ON public.orders USING btree (order_date DESC);


--
-- Name: orders_gateway_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_gateway_idx ON public.orders USING btree (gateway);


--
-- Name: orders_order_number_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_order_number_trgm_idx ON public.orders USING gin (order_number public.gin_trgm_ops);


--
-- Name: orders_payout_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_payout_status_idx ON public.orders USING btree (payout_status);


--
-- Name: orders_store_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_store_date_idx ON public.orders USING btree (store_id, order_date DESC);


--
-- Name: orders_store_id_order_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_store_id_order_date_idx ON public.orders USING btree (store_id, order_date);


--
-- Name: orders_uid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX orders_uid_idx ON public.orders USING btree (uid);


--
-- Name: orders_uid_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX orders_uid_key ON public.orders USING btree (uid);


--
-- Name: payout_email_ingests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_email_ingests_status_idx ON public.payout_email_ingests USING btree (status, created_at DESC);


--
-- Name: payout_reverts_line_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_reverts_line_idx ON public.payout_reverts USING btree (bank_line_id);


--
-- Name: payout_transactions_matched_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_transactions_matched_order_id_idx ON public.payout_transactions USING btree (matched_order_id);


--
-- Name: payouts_gateway_payout_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payouts_gateway_payout_id_key ON public.payouts USING btree (gateway, payout_id);


--
-- Name: payouts_statement_no_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payouts_statement_no_idx ON public.payouts USING btree (statement_no);


--
-- Name: pending_zoho_sync_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pending_zoho_sync_open ON public.pending_zoho_sync USING btree (created_at) WHERE (cleared_at IS NULL);


--
-- Name: pending_zoho_sync_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pending_zoho_sync_sku_idx ON public.pending_zoho_sync USING btree (sku) WHERE (cleared_at IS NULL);


--
-- Name: pilot_leads_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pilot_leads_created_idx ON public.pilot_leads USING btree (created_at DESC);


--
-- Name: pilot_leads_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pilot_leads_status_idx ON public.pilot_leads USING btree (status);


--
-- Name: recon_lines_bank_line_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX recon_lines_bank_line_idx ON public.recon_lines USING btree (bank_line_id);


--
-- Name: reconcile_tasks_priority_enqueued_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reconcile_tasks_priority_enqueued_at_idx ON public.reconcile_tasks USING btree (priority, enqueued_at) WHERE (claimed_at IS NULL);


--
-- Name: reconcile_tasks_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reconcile_tasks_sku_idx ON public.reconcile_tasks USING btree (sku) WHERE ((completed_at IS NULL) AND (claimed_at IS NULL));


--
-- Name: refund_postings_line_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refund_postings_line_idx ON public.refund_postings USING btree (bank_line_id);


--
-- Name: refunds_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refunds_status_idx ON public.refunds USING btree (status);


--
-- Name: returns_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX returns_order_id_idx ON public.returns USING btree (order_id);


--
-- Name: returns_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX returns_status_idx ON public.returns USING btree (status);


--
-- Name: settlement_documents_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX settlement_documents_token_idx ON public.settlement_documents USING btree (confirm_token);


--
-- Name: settlement_records_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX settlement_records_date_idx ON public.settlement_records USING btree (settlement_date DESC);


--
-- Name: settlement_records_evidence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX settlement_records_evidence_idx ON public.settlement_records USING btree (evidence_confirmed, zoho_payment_id);


--
-- Name: settlement_records_gateway_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX settlement_records_gateway_idx ON public.settlement_records USING btree (gateway);


--
-- Name: shopify_variant_map_store_id_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shopify_variant_map_store_id_sku_idx ON public.shopify_variant_map USING btree (store_id, sku);


--
-- Name: stock_alerts_open_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stock_alerts_open_unique ON public.stock_alerts USING btree (sku, kind) WHERE (resolved_at IS NULL);


--
-- Name: stock_events_id_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_events_id_desc ON public.stock_events USING btree (id DESC);


--
-- Name: stock_events_sku_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_events_sku_occurred_at_idx ON public.stock_events USING btree (sku, occurred_at DESC);


--
-- Name: stock_events_source_ingested_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_events_source_ingested_at_idx ON public.stock_events USING btree (source, ingested_at DESC);


--
-- Name: store_inventory_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_inventory_sku_idx ON public.store_inventory USING btree (sku);


--
-- Name: store_inventory_store_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_inventory_store_idx ON public.store_inventory USING btree (store_id);


--
-- Name: stores_store_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stores_store_id_key ON public.stores USING btree (store_id);


--
-- Name: sync_runs_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_runs_started_idx ON public.sync_runs USING btree (started_at DESC);


--
-- Name: tasks_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_status_idx ON public.tasks USING btree (status, created_at DESC);


--
-- Name: uploaded_files_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uploaded_files_kind_idx ON public.uploaded_files USING btree (kind, uploaded_at DESC);


--
-- Name: user_profiles_auth_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_profiles_auth_id_key ON public.user_profiles USING btree (auth_id);


--
-- Name: user_profiles_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_profiles_email_key ON public.user_profiles USING btree (email);


--
-- Name: zoho_action_log_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zoho_action_log_at_idx ON public.zoho_action_log USING btree (at DESC);


--
-- Name: zoho_bank_txn_postings_line_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX zoho_bank_txn_postings_line_idx ON public.zoho_bank_txn_postings USING btree (bank_line_id);


--
-- Name: zoho_item_warehouse_last_modified_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zoho_item_warehouse_last_modified_idx ON public.zoho_item_warehouse_stock USING btree (last_modified_time DESC);


--
-- Name: zoho_item_warehouse_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zoho_item_warehouse_sku_idx ON public.zoho_item_warehouse_stock USING btree (sku);


--
-- Name: zoho_item_warehouse_warehouse_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zoho_item_warehouse_warehouse_idx ON public.zoho_item_warehouse_stock USING btree (warehouse_id);


--
-- Name: zoho_items_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zoho_items_sku_idx ON public.zoho_items USING btree (sku);


--
-- Name: zoho_ledger_lines_month_acct_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zoho_ledger_lines_month_acct_idx ON public.zoho_ledger_lines USING btree (month, account_id);


--
-- Name: zoho_orders_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zoho_orders_number_idx ON public.zoho_orders USING btree (salesorder_number);


--
-- Name: zoho_orders_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zoho_orders_ref_idx ON public.zoho_orders USING btree (reference_number);


--
-- Name: zoho_postings_bank_line_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX zoho_postings_bank_line_idx ON public.zoho_postings USING btree (bank_line_id);


--
-- Name: zoho_publish_runs_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zoho_publish_runs_started_idx ON public.zoho_publish_runs USING btree (started_at DESC);


--
-- Name: zoho_sync_runs_full_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zoho_sync_runs_full_idx ON public.zoho_sync_runs USING btree (started_at DESC) WHERE (sync_mode = 'full'::text);


--
-- Name: zoho_sync_runs_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zoho_sync_runs_started_idx ON public.zoho_sync_runs USING btree (started_at DESC);


--
-- Name: ad_insights ad_insights_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_insights
    ADD CONSTRAINT ad_insights_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ad_campaigns(id);


--
-- Name: exchanges exchanges_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchanges
    ADD CONSTRAINT exchanges_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.returns(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_reservations inventory_reservations_order_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_order_uid_fkey FOREIGN KEY (order_uid) REFERENCES public.orders(uid) ON DELETE CASCADE;


--
-- Name: order_attachments order_attachments_order_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_attachments
    ADD CONSTRAINT order_attachments_order_uid_fkey FOREIGN KEY (order_uid) REFERENCES public.orders(uid) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: orders orders_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: payout_transactions payout_transactions_payout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_transactions
    ADD CONSTRAINT payout_transactions_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.payouts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_order_items purchase_order_items_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: refunds refunds_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.returns(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: return_shipments return_shipments_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_shipments
    ADD CONSTRAINT return_shipments_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.returns(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: returns returns_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: settlement_document_links settlement_document_links_settlement_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_document_links
    ADD CONSTRAINT settlement_document_links_settlement_document_id_fkey FOREIGN KEY (settlement_document_id) REFERENCES public.settlement_documents(id);


--
-- Name: settlement_document_links settlement_document_links_settlement_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_document_links
    ADD CONSTRAINT settlement_document_links_settlement_record_id_fkey FOREIGN KEY (settlement_record_id) REFERENCES public.settlement_records(id);


--
-- Name: settlement_documents settlement_documents_uploaded_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_documents
    ADD CONSTRAINT settlement_documents_uploaded_file_id_fkey FOREIGN KEY (uploaded_file_id) REFERENCES public.uploaded_files(id);


--
-- Name: zoho_item_warehouse_stock zoho_item_warehouse_stock_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoho_item_warehouse_stock
    ADD CONSTRAINT zoho_item_warehouse_stock_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.zoho_warehouses(warehouse_id);


--
-- Name: channel_buckets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.channel_buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_reservations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: order_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_zoho_sync; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_zoho_sync ENABLE ROW LEVEL SECURITY;

--
-- Name: profit_share_payees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profit_share_payees ENABLE ROW LEVEL SECURITY;

--
-- Name: reconcile_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reconcile_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: shopify_variant_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shopify_variant_map ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_events ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_write_intents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_write_intents ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: warehouse_stock_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.warehouse_stock_events ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_heartbeat; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_heartbeat ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_inbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_inbox ENABLE ROW LEVEL SECURITY;

--
-- Name: woo_product_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.woo_product_map ENABLE ROW LEVEL SECURITY;

--
-- Name: zoho_item_warehouse_stock; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zoho_item_warehouse_stock ENABLE ROW LEVEL SECURITY;

--
-- Name: zoho_warehouses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zoho_warehouses ENABLE ROW LEVEL SECURITY;

--
-- Name: zoho_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zoho_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--



-- pg_dump emptied search_path for this session; restore it so anything run
-- after this file in the same session resolves unqualified names normally.
RESET search_path;

CREATE TABLE IF NOT EXISTS public.ad_analyst_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    tenant_id text DEFAULT 'omnia'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    range_from date NOT NULL,
    range_to date NOT NULL,
    model text DEFAULT ''::text NOT NULL,
    report jsonb NOT NULL,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ad_analyst_reports_created_idx ON public.ad_analyst_reports USING btree (tenant_id, created_at DESC);

-- ── Settings & connections foundation (2026-10-07) ─────────────────────────
-- docs/superpowers/specs/2026-10-07-settings-connections-foundation-design.md
create table if not exists connections (
  id               text primary key,
  tenant_id        text not null default 'omnia',
  provider         text not null,
  auth_mode        text not null,
  grant_type       text not null default 'authorization_code',
  account_ref      text not null,
  label            text not null,
  config           jsonb not null default '{}',
  secrets_enc      text not null default '',
  scopes           text not null default '',
  status           text not null default 'active',
  last_checked_at  timestamptz,
  last_synced_at   timestamptz,
  last_error       text not null default '',
  connected_by     text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, provider, account_ref)
);
create index if not exists connections_tenant_provider on connections (tenant_id, provider);

create table if not exists workspace_settings (
  tenant_id   text not null default 'omnia',
  key         text not null,
  value       jsonb not null,
  updated_by  text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table if not exists oauth_states (
  state            text primary key,
  tenant_id        text not null,
  provider         text not null,
  auth_mode        text not null,
  pkce_verifier    text not null default '',
  pending_app_enc  text not null default '',
  params           jsonb not null default '{}',
  created_by       text not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  used_at          timestamptz
);

create table if not exists pending_grants (
  id          text primary key,
  tenant_id   text not null,
  provider    text not null,
  auth_mode   text not null,
  grant_enc   text not null,
  accounts    jsonb not null default '[]',
  params      jsonb not null default '{}',
  created_by  text not null,
  expires_at  timestamptz not null
);
