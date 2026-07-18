"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type ConfirmData = {
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  filename: string;
  settlements: { id: string; orderNumber: string; customerName: string; grossAed: number; gateway: string; settlementDate: string | null }[];
};

export default function ConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ConfirmData | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/confirm/${token}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError("Could not load this confirmation link."));
  }, [token]);

  async function confirm() {
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/confirm/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedBy: name.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Confirm failed");
      setData((d) => (d ? { ...d, confirmed: true, confirmedBy: json.confirmedBy, confirmedAt: json.confirmedAt } : d));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !data) return <div style={{ padding: 32 }}>{error}</div>;
  if (!data) return <div style={{ padding: 32 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: 32, fontFamily: "sans-serif" }}>
      <h1>Confirm settlement</h1>
      <p>Document: {data.filename} — <a href={`/api/confirm/${token}/document`} target="_blank" rel="noreferrer">view</a></p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead>
          <tr><th align="left">Order</th><th align="left">Customer</th><th align="right">Gross AED</th><th align="left">Gateway</th></tr>
        </thead>
        <tbody>
          {data.settlements.map((s) => (
            <tr key={s.id}>
              <td>{s.orderNumber}</td>
              <td>{s.customerName}</td>
              <td align="right">{s.grossAed.toFixed(2)}</td>
              <td>{s.gateway}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.confirmed ? (
        <p style={{ marginTop: 24, color: "green" }}>
          Confirmed by {data.confirmedBy} at {data.confirmedAt}
        </p>
      ) : (
        <div style={{ marginTop: 24 }}>
          <input
            placeholder="Your name or email"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ padding: 8, marginRight: 8, width: 240 }}
          />
          <button onClick={confirm} disabled={submitting || !name.trim()}>
            {submitting ? "Confirming…" : "Confirm settlement"}
          </button>
          {error && <p style={{ color: "red" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
