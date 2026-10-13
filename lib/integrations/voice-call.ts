// Outbound phone call that reads a message aloud (Twilio Programmable Voice,
// inline TwiML — no public webhook needed). No-ops until TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN and TWILIO_FROM are set, same guard style as Telegram.

export function voiceCallConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function placeVoiceCall(to: string, message: string): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  if (!voiceCallConfigured()) return { ok: false, error: "Voice calls are not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM)" };
  if (!/^\+\d{8,15}$/.test(to)) return { ok: false, error: "Phone number must be E.164, e.g. +9715…" };
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  // Said twice: people often miss the first seconds of an unexpected call.
  const twiml = `<Response><Say voice="Polly.Joanna">${xml(message)}</Say><Pause length="1"/><Say voice="Polly.Joanna">Repeating. ${xml(message)}</Say></Response>`;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Twiml: twiml }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.message || `HTTP ${res.status}` };
    return { ok: true, sid: json.sid };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
