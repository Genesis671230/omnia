// SendGrid v3 mail send — plain REST call, no SDK dependency needed for one
// endpoint. Requires FROM_EMAIL to be a sender SendGrid has verified for this
// account (single-sender or domain auth); an unverified from-address is
// rejected by SendGrid regardless of API key validity.

export function emailConfigured(): boolean {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.FROM_EMAIL);
}

export async function sendEmail(input: { to: string; subject: string; html: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!emailConfigured()) return { ok: false, error: "Email is not configured (SENDGRID_API_KEY / FROM_EMAIL)" };
  if (!input.to) return { ok: false, error: "No recipient email on this order" };

  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.to }] }],
        from: { email: process.env.FROM_EMAIL, name: "Omnia Stores" },
        subject: input.subject,
        content: [{ type: "text/html", value: input.html }],
      }),
    });
    if (res.status === 202) return { ok: true };
    const body = await res.text();
    return { ok: false, error: `SendGrid HTTP ${res.status}: ${body.slice(0, 300)}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function shipmentEmailHtml(input: { customerName: string; orderNumber: string; awb: string; courier: string; etaDays: string }): string {
  const name = input.customerName || "there";
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; color: #1F1B16;">
      <h2 style="color: #B08343; margin-bottom: 4px;">Your order is on the way</h2>
      <p>Hi ${name},</p>
      <p>Order <b>#${input.orderNumber}</b> has shipped via <b>${input.courier}</b>.</p>
      <p style="background: #FBF3E6; padding: 12px 16px; border-radius: 8px;">
        Tracking number: <b>${input.awb}</b><br/>
        Expected delivery: <b>${input.etaDays}</b>
      </p>
      <p>Thank you for shopping with Omnia Stores.</p>
    </div>`;
}
