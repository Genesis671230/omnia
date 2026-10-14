/* Server side of the RAMZA funnel: store events, tie them to a lead, and
 * count the funnel for the /leads inbox. */

import { supabase } from "@/lib/supabase";

const s = (v: unknown, n: number) => (typeof v === "string" ? v : "").trim().slice(0, n);
const NAME = /^[a-z][a-z0-9_]{1,40}$/;

/** Props are kept small and flat: strings/numbers/booleans only. */
function cleanProps(v: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 16)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(k)) continue;
    if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
    else if (typeof x === "boolean") out[k] = x;
    else if (typeof x === "string") out[k] = x.slice(0, 120);
  }
  return out;
}

export async function storeEvents(body: unknown): Promise<{ stored: number } | { error: string }> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const anon = s(b.anonId, 64);
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(anon)) return { error: "bad anon id" };
  const a = (b.attribution && typeof b.attribution === "object" ? b.attribution : {}) as Record<string, unknown>;
  const events = Array.isArray(b.events) ? b.events.slice(0, 40) : [];
  const rows = events
    .map((e) => (e && typeof e === "object" ? e : {}) as Record<string, unknown>)
    .filter((e) => NAME.test(s(e.name, 41)))
    .map((e) => ({
      anon_id: anon, session_id: s(b.sessionId, 64), name: s(e.name, 41), props: cleanProps(e.props), path: s(e.path, 200),
      utm_source: s(a.utm_source, 120), utm_medium: s(a.utm_medium, 120), utm_campaign: s(a.utm_campaign, 160), utm_content: s(a.utm_content, 160),
      referrer: s(a.referrer, 300),
      created_at: typeof e.ts === "number" && Math.abs(Date.now() - e.ts) < 6 * 3600_000 ? new Date(e.ts).toISOString() : new Date().toISOString(),
    }));
  if (!rows.length) return { stored: 0 };
  const { error } = await supabase.from("ramza_events").insert(rows);
  return error ? { error: error.message } : { stored: rows.length };
}

export async function linkLead(anonId: string, leadId: string): Promise<void> {
  if (!anonId) return;
  await supabase.from("ramza_events").update({ lead_id: leadId }).eq("anon_id", anonId).is("lead_id", null);
}

export type FunnelStats = {
  days: number;
  steps: { name: string; visitors: number; rate: number }[];
  bySource: { source: string; visitors: number; demos: number; leads: number }[];
  byIndustry: { industry: string; demos: number; leads: number }[];
  tools: { tool: string; uses: number }[];
  recent: { anonId: string; leadId: string | null; source: string; firstAt: string; lastAt: string; steps: string[] }[];
};

const STEPS = ["page_view", "demo_start", "demo_complete", "report_open", "lead"];

export async function funnelStats(days = 30): Promise<FunnelStats> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows: { anon_id: string; name: string; props: Record<string, unknown>; utm_source: string; referrer: string; lead_id: string | null; created_at: string }[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await supabase.from("ramza_events").select("anon_id, name, props, utm_source, referrer, lead_id, created_at").gte("created_at", since).order("created_at").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const byAnon = new Map<string, typeof rows>();
  for (const r of rows) byAnon.set(r.anon_id, [...(byAnon.get(r.anon_id) ?? []), r]);
  const has = (list: typeof rows, n: string) => list.some((r) => r.name === n);
  const sourceOf = (list: typeof rows) => list.find((r) => r.utm_source)?.utm_source || (list[0]?.referrer ? new URL(list[0].referrer, "https://x").hostname.replace(/^www\./, "") : "direct");

  const visitors = [...byAnon.values()];
  const top = visitors.filter((l) => has(l, "page_view")).length || visitors.length;
  const steps = STEPS.map((n) => {
    const v = visitors.filter((l) => has(l, n)).length;
    return { name: n, visitors: v, rate: top ? v / top : 0 };
  });
  const src = new Map<string, { source: string; visitors: number; demos: number; leads: number }>();
  for (const l of visitors) {
    const k = sourceOf(l);
    const e = src.get(k) ?? { source: k, visitors: 0, demos: 0, leads: 0 };
    e.visitors += 1; if (has(l, "demo_start")) e.demos += 1; if (has(l, "lead")) e.leads += 1;
    src.set(k, e);
  }
  const ind = new Map<string, { industry: string; demos: number; leads: number }>();
  for (const l of visitors) {
    const i = String(l.find((r) => r.name === "demo_start")?.props?.industry ?? "");
    if (!i) continue;
    const e = ind.get(i) ?? { industry: i, demos: 0, leads: 0 };
    e.demos += 1; if (has(l, "lead")) e.leads += 1;
    ind.set(i, e);
  }
  const tools = new Map<string, number>();
  for (const r of rows) if (r.name === "tool_use") tools.set(String(r.props?.tool ?? "?"), (tools.get(String(r.props?.tool ?? "?")) ?? 0) + 1);
  const recent = visitors
    .map((l) => ({ anonId: l[0].anon_id, leadId: l.find((r) => r.lead_id)?.lead_id ?? null, source: sourceOf(l), firstAt: l[0].created_at, lastAt: l[l.length - 1].created_at,
      steps: [...new Set(l.map((r) => r.name))] }))
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)).slice(0, 40);
  return {
    days, steps,
    bySource: [...src.values()].sort((a, b) => b.visitors - a.visitors).slice(0, 12),
    byIndustry: [...ind.values()].sort((a, b) => b.demos - a.demos),
    tools: [...tools].map(([tool, uses]) => ({ tool, uses })).sort((a, b) => b.uses - a.uses),
    recent,
  };
}
