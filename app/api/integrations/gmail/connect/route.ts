import { NextResponse } from "next/server";
import { gmailConsentUrl } from "@/lib/integrations/gmail";

// GET /api/integrations/gmail/connect — start the one-time consent that mints
// a refresh token for the ingest mailbox. Visit this as the mailbox owner
// (marketingomniastore@gmail.com), approve, and the callback prints the token
// to paste into GMAIL_REFRESH_TOKEN.
export async function GET(request: Request) {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET first (Google Cloud Console → Credentials → OAuth client ID → Web application)." },
      { status: 400 },
    );
  }

  const redirectUri =
    process.env.GMAIL_REDIRECT_URI || new URL("/api/integrations/gmail/callback", request.url).toString();

  return NextResponse.redirect(gmailConsentUrl(redirectUri));
}
