import { NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/integrations/gmail";

// GET /api/integrations/gmail/callback — Google redirects here after consent.
// Shows the refresh token once so it can be pasted into .env.local. The token
// is deliberately NOT written to disk or the database: it is a long-lived
// credential and belongs in the environment, alongside every other secret here.
export async function GET(request: Request) {
  const url = new URL(request.url);
  console.log("url", url.toString());
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  

  if (error) {
    return new NextResponse(page(`Google returned an error: ${escapeHtml(error)}`), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (!code) {
    return new NextResponse(page("No authorization code in the callback."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const redirectUri =
    process.env.GMAIL_REDIRECT_URI || new URL("/api/integrations/gmail/callback", request.url).toString();

  try {
    const { refreshToken } = await exchangeCodeForTokens(code, redirectUri);
    if (!refreshToken) {
      return new NextResponse(
        page(
          "Google did not return a refresh token. That happens when this account has already granted access — " +
            "remove it at myaccount.google.com/permissions and run /api/integrations/gmail/connect again.",
        ),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }
    return new NextResponse(
      page(
        "Gmail connected. Add this to .env.local and restart:",
        `GMAIL_REFRESH_TOKEN=${refreshToken}`,
      ),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (e) {
    return new NextResponse(page(`Token exchange failed: ${escapeHtml((e as Error).message)}`), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function page(message: string, token?: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Gmail connection</title>
<body style="font:14px/1.6 ui-sans-serif,system-ui;max-width:52rem;margin:4rem auto;padding:0 1.5rem;color:#1F1B16;background:#FBF8F1">
<h1 style="font-size:1.1rem;margin:0 0 1rem">Gmail payout ingest</h1>
<p style="margin:0 0 1rem">${escapeHtml(message)}</p>
${token ? `<pre style="background:#F3EFE7;border:1px solid #EAE3D6;border-radius:8px;padding:1rem;overflow-x:auto;user-select:all">${escapeHtml(token)}</pre>` : ""}
</body>`;
}
