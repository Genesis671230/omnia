"use client";

/* Sales-order settings — the salesorders.* workspace settings (fixed rates,
 * tax treatment + Zoho tax per region, invoice date, mark sent, warehouse,
 * per-run limit, tolerance, SKU aliases, packing sheet per month). Read and
 * written through /api/settings, which is admin-only and validates each value. */

import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

type Setting = { key: string; label: string; help?: string; kind: "text" | "number" | "toggle" | "select" | "json" | "tags"; options?: string[]; value: unknown; source: string };

export function SoSettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Setting[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        const j = await res.json();
        if (!res.ok) throw new Error(res.status === 403 ? "Only an admin can change these settings" : j.error || `HTTP ${res.status}`);
        const mine = (j.settings as Setting[]).filter((s) => s.key.startsWith("salesorders."));
        setRows(mine);
        setDraft(Object.fromEntries(mine.map((s) => [s.key, s.kind === "json" ? JSON.stringify(s.value, null, 2) : (s.value as string | number | boolean)])));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  async function save() {
    if (!rows) return;
    const values: Record<string, unknown> = {};
    try {
      for (const s of rows) {
        const v = draft[s.key];
        const parsed = s.kind === "json" ? JSON.parse(String(v)) : s.kind === "number" ? Number(v) : v;
        if (JSON.stringify(parsed) !== JSON.stringify(s.value)) values[s.key] = parsed;
      }
    } catch {
      return toast.error("One of the JSON fields is not valid JSON");
    }
    if (!Object.keys(values).length) return onClose();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      toast.success(`${Object.keys(values).length} setting(s) saved`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const body = (
    <div className="fixed inset-0 z-[90] flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="h-full w-full max-w-[560px] overflow-y-auto bg-[#F6F8FC] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[20px] font-light text-slate-900">Sales-order settings</div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-white"><X size={18} /></button>
        </div>
        {error && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700 ring-1 ring-rose-200">{error}</div>}
        {!rows ? (!error && <div className="flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>) : (
          <div className="space-y-3">
            {rows.map((s) => (
              <label key={s.key} className="block rounded-2xl bg-white p-3 shadow-sm">
                <div className="text-[13px] font-medium text-slate-800">{s.label.replace(/^Sales orders: /, "")}</div>
                {s.help && <div className="mb-1.5 text-[11.5px] text-slate-500">{s.help}</div>}
                {s.kind === "toggle" ? (
                  <input type="checkbox" checked={Boolean(draft[s.key])} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.checked })} />
                ) : s.kind === "select" ? (
                  <select value={String(draft[s.key])} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} className="h-9 w-full rounded-lg border border-slate-200 px-2 text-[13px]">
                    {(s.options ?? []).map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : s.kind === "json" ? (
                  <textarea value={String(draft[s.key])} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} rows={Math.min(8, String(draft[s.key]).split("\n").length + 1)} className="w-full rounded-lg border border-slate-200 p-2 font-mono text-[12px]" />
                ) : (
                  <input type={s.kind === "number" ? "number" : "text"} step="any" value={String(draft[s.key] ?? "")} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} className="h-9 w-full rounded-lg border border-slate-200 px-2 text-[13px]" />
                )}
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="rounded-full px-4 py-2 text-[13px] text-slate-600 ring-1 ring-slate-200 hover:bg-white">Cancel</button>
              <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-full bg-[#2347D9] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50">{saving && <Loader2 size={13} className="animate-spin" />} Save settings</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}
