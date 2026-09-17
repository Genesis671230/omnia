// Gmail read access for payout-report ingestion.
//
// Self-rolled OAuth in the same style as lib/integrations/zoho.ts and
// lib/integrations/google-sheets.ts — no googleapis / google-auth-library
// dependency, just fetch against the REST endpoints. Read-only scope: this
// module never sends, labels, or deletes anything.
//
// A consumer @gmail.com mailbox cannot be reached with a service account
// (domain-wide delegation is a Workspace feature), so access is a refresh token
// minted once through /api/integrations/gmail/connect.
//
// Setup (only the user can do this):
// 1. Google Cloud Console → project → enable the Gmail API.
// 2. APIs & Services → Credentials → Create OAuth client ID → Web application.
// 3. Add the redirect URI (GMAIL_REDIRECT_URI, e.g.
//    http://localhost:3000/api/integrations/gmail/callback).
// 4. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET, then visit
//    /api/integrations/gmail/connect and approve as the mailbox owner.
// 5. Paste the printed refresh token into GMAIL_REFRESH_TOKEN.
//
// GMAIL_USER accepts a comma-separated list, so a second mailbox is a config
// change rather than a code change. Each mailbox may carry its own refresh
// token via GMAIL_REFRESH_TOKEN_<SLUG>; the bare GMAIL_REFRESH_TOKEN is the
// default for the first/only mailbox.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const API_BASE = "https://gmail.googleapis.com/gmail/v1";

/** Read-only: enough to search and download attachments, nothing more. */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function gmailConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN,
  );
}

/** Mailboxes to poll, in configuration order. */
export function gmailMailboxes(): string[] {
  return String(process.env.GMAIL_USER || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Per-mailbox refresh token, falling back to the single shared one. A second
 *  mailbox sets GMAIL_REFRESH_TOKEN_<SLUG>, e.g. marketingomniastore@gmail.com
 *  → GMAIL_REFRESH_TOKEN_MARKETINGOMNIASTORE. */
export function refreshTokenFor(mailbox: string): string | undefined {
  const slug = mailbox.split("@")[0].replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return process.env[`GMAIL_REFRESH_TOKEN_${slug}`] || process.env.GMAIL_REFRESH_TOKEN;
}

/** The consent URL the mailbox owner visits once.
 *  `prompt=consent` + `access_type=offline` is what makes Google return a
 *  refresh token rather than only an access token. */
export function gmailConsentUrl(redirectUri: string, state?: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID || "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  if (state) params.set("state", state);
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken?: string; accessToken: string; expiresIn: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GMAIL_CLIENT_ID || "",
      client_secret: process.env.GMAIL_CLIENT_SECRET || "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Gmail token exchange failed: ${json.error_description || json.error || res.status}`);
  return { refreshToken: json.refresh_token, accessToken: json.access_token, expiresIn: json.expires_in };
}

// Access tokens are cached per mailbox until ~5 minutes before expiry, and
// concurrent refreshes share one in-flight promise — same shape as the Zoho
// client, so a polling cycle doesn't mint a token per request.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const inFlight = new Map<string, Promise<string>>();

export async function getAccessToken(mailbox: string): Promise<string> {
  const cached = tokenCache.get(mailbox);
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) return cached.token;

  const pending = inFlight.get(mailbox);
  if (pending) return pending;

  const promise = refreshAccessToken(mailbox).finally(() => inFlight.delete(mailbox));
  inFlight.set(mailbox, promise);
  return promise;
}

async function refreshAccessToken(mailbox: string): Promise<string> {
  const refreshToken = refreshTokenFor(mailbox);
  if (!refreshToken) throw new Error(`No Gmail refresh token configured for ${mailbox}`);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GMAIL_CLIENT_ID || "",
      client_secret: process.env.GMAIL_CLIENT_SECRET || "",
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed for ${mailbox}: ${json.error_description || json.error || res.status}`);
  }
  tokenCache.set(mailbox, {
    token: json.access_token,
    expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000,
  });
  return json.access_token;
}

async function gmailGet<T>(mailbox: string, path: string, params?: Record<string, string>): Promise<T> {
  const token = await getAccessToken(mailbox);
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  const res = await fetch(`${API_BASE}/users/${encodeURIComponent(mailbox)}${path}${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export type GmailMessageRef = { id: string; threadId: string };

/** Message ids matching a Gmail search query, newest first. */
export async function searchMessages(
  mailbox: string,
  query: string,
  maxResults = 50,
): Promise<GmailMessageRef[]> {
  const out: GmailMessageRef[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gmailGet<{ messages?: GmailMessageRef[]; nextPageToken?: string }>(
      mailbox,
      "/messages",
      {
        q: query,
        maxResults: String(Math.min(100, maxResults - out.length)),
        ...(pageToken ? { pageToken } : {}),
      },
    );
    out.push(...(page.messages ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && out.length < maxResults);
  return out.slice(0, maxResults);
}

export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
};

export async function getMessage(mailbox: string, id: string): Promise<GmailMessage> {
  return gmailGet<GmailMessage>(mailbox, `/messages/${encodeURIComponent(id)}`, { format: "full" });
}

export async function getAttachment(
  mailbox: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const json = await gmailGet<{ data?: string; size?: number }>(
    mailbox,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  if (!json.data) throw new Error(`Gmail attachment ${attachmentId} returned no data`);
  return Buffer.from(json.data, "base64url");
}

/** Header lookup is case-insensitive — Gmail echoes whatever casing the sender used. */
export function headerValue(msg: GmailMessage, name: string): string {
  const target = name.toLowerCase();
  for (const h of msg.payload?.headers ?? []) {
    if (h.name.toLowerCase() === target) return h.value;
  }
  return "";
}

/** Every part of a MIME tree, depth-first — attachments nest arbitrarily deep
 *  inside multipart/mixed → multipart/related → … , and a forwarded message
 *  adds another level. */
export function flattenParts(part: GmailPart | undefined): GmailPart[] {
  if (!part) return [];
  return [part, ...(part.parts ?? []).flatMap(flattenParts)];
}
