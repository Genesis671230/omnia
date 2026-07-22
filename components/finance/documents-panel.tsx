"use client";

/* Bank actuals — every raw bank statement + gateway payout file ever
   ingested, in one place: upload here (same parsers as the reconciliation
   flow), or download exactly what was uploaded. Also offers a one-click pull
   from live gateway APIs (Telr / Stripe) when credentials are configured. */

import { Download, FileSpreadsheet, Landmark, Loader2, Upload, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type FileMeta = {
  id: string;
  kind: "bank" | "payout";
  provider: string | null;
  filename: string;
  mime: string | null;
  size_bytes: number | null;
  parse_summary: string | null;
  uploaded_at: string;
};

const PROVIDERS = ["Telr", "Tamara", "Tabby", "Stripe", "Checkout"];

const fmtBytes = (n: number | null) => {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function DocumentsPanel({ version, onDone }: { version: number; onDone: () => void }) {
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "bank" | "payout">("all");
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [apiStatus, setApiStatus] = useState<{ telr: boolean; stripe: boolean } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const bankInput = useRef<HTMLInputElement>(null);
  const payoutInput = useRef<HTMLInputElement>(null);
  const [busyBank, setBusyBank] = useState(false);
  const [busyPayout, setBusyPayout] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/files");
      const json = await res.json();
      setFiles(json.files ?? []);
    } catch (e) {
      toast.error(`Couldn't load documents: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, version]);
  useEffect(() => {
    fetch("/api/integrations/payouts").then((r) => r.json()).then(setApiStatus).catch(() => setApiStatus({ telr: false, stripe: false }));
  }, []);

  const uploadBank = async (file?: File) => {
    if (!file) return;
    setBusyBank(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload/bank", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(
        `${json.credits} credits + ${json.debits} debits parsed (${json.inserted} new` +
          (json.updated ? `, ${json.updated} corrected` : "") +
          ")",
      );
      onDone(); load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyBank(false);
      if (bankInput.current) bankInput.current.value = "";
    }
  };

  const uploadPayout = async (file?: File) => {
    if (!file) return;
    setBusyPayout(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("provider", provider);
      const res = await fetch("/api/upload/payout", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(`Payout saved: ${json.payouts?.map((p: { id: string }) => p.id).join(", ")}`);
      onDone(); load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyPayout(false);
      if (payoutInput.current) payoutInput.current.value = "";
    }
  };

  const syncLive = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/integrations/payouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: 30 }) });
      const json = await res.json();
      if (json.message) toast.info(json.message);
      for (const r of json.results ?? []) {
        if (r.error) toast.error(`${r.provider}: ${r.error}`);
        else toast.success(`${r.provider}: ${r.fetched} payouts pulled live`);
      }
      onDone(); load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const rows = files.filter((f) => filter === "all" || f.kind === filter);
  const anyApi = apiStatus?.telr || apiStatus?.stripe;

  return (
    <>
      <div className="docpanel-actions">
        <div className="docpanel-upload">
          <button className="btn primary" disabled={busyBank} onClick={() => bankInput.current?.click()}>
            {busyBank ? <Loader2 size={14} className="spin" /> : <Landmark size={14} />} Upload bank statement
          </button>
          <input ref={bankInput} type="file" className="hidden-input" accept=".pdf,.csv,.txt" onChange={(e) => uploadBank(e.target.files?.[0])} />
          <span className="docpanel-hint">.pdf or .csv — any bank</span>
        </div>

        <div className="docpanel-upload">
          <select className="docpanel-select" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="btn" disabled={busyPayout} onClick={() => payoutInput.current?.click()}>
            {busyPayout ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} Upload payout file
          </button>
          <input ref={payoutInput} type="file" className="hidden-input" accept=".csv,.xls,.xlsx" onChange={(e) => uploadPayout(e.target.files?.[0])} />
          <span className="docpanel-hint">.xls/.xlsx/.csv — format auto-detected</span>
        </div>

        {anyApi && (
          <button className="btn ghost" disabled={syncing} onClick={syncLive}>
            {syncing ? <Loader2 size={14} className="spin" /> : <Zap size={14} />} Pull live from {[apiStatus?.telr && "Telr", apiStatus?.stripe && "Stripe"].filter(Boolean).join(" + ")}
          </button>
        )}
      </div>

      <div className="tabs" style={{ marginTop: 18 }}>
        {([["all", "All documents", files.length], ["bank", "Bank statements", files.filter((f) => f.kind === "bank").length], ["payout", "Payout files", files.filter((f) => f.kind === "payout").length]] as [typeof filter, string, number][]).map(([k, l, n]) => (
          <button key={k} className={filter === k ? "tab on" : "tab"} onClick={() => setFilter(k)}>{l} <span className="count">{n}</span></button>
        ))}
      </div>

      {loading ? (
        <div className="empty"><Loader2 size={18} className="spin" /> Loading documents…</div>
      ) : rows.length === 0 ? (
        <div className="empty">No documents uploaded yet. Every bank statement and payout file you upload — here or from the reconciliation tab — is archived and downloadable.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th></th><th>File</th><th>Provider</th><th>Size</th><th>Parsed</th><th>Uploaded</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <td>{f.kind === "bank" ? <Landmark size={14} className="tick" /> : <FileSpreadsheet size={14} className="tick" />}</td>
                  <td className="mono" title={f.filename} style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</td>
                  <td>{f.provider ? <span className="store-badge">{f.provider}</span> : <span className="store-badge">bank</span>}</td>
                  <td className="mono">{fmtBytes(f.size_bytes)}</td>
                  <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }} title={f.parse_summary ?? ""}>{f.parse_summary ?? "—"}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{fmtDate(f.uploaded_at)}</td>
                  <td><a className="btn ghost small" href={`/api/files/${f.id}`}><Download size={13} /> Download</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .docpanel-actions { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 4px; }
        .docpanel-upload { display: flex; align-items: center; gap: 8px; }
        .docpanel-hint { font-size: 11.5px; color: var(--muted); }
        .docpanel-select { border: 1px solid var(--line-strong); border-radius: 9px; padding: 9px 12px; font-size: 13px; background: var(--card); color: var(--ink); }
      `}</style>
    </>
  );
}
