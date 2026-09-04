// Google Sheets write access via a service account (JWT Bearer flow,
// RFC 7523) — no googleapis/google-auth-library dependency, same self-rolled
// OAuth style as lib/integrations/zoho.ts. No-ops until configured, same
// `configured()` guard pattern as every other integration here.
//
// Setup (only the user can do this — see the walkthrough in chat):
// 1. Google Cloud Console → new/existing project → enable the Sheets API.
// 2. IAM & Admin → Service Accounts → create one → Keys → Add key → JSON.
// 3. Share the target Google Sheet with the service account's email
//    (client_email in the downloaded JSON), Editor access.
// 4. The sheet must be a NATIVE Google Sheet, not an .xlsx file sitting in
//    Drive — File → Save as Google Sheets first if it's currently uploaded
//    as Excel, which changes its ID (use the new one).
// 5. Set GOOGLE_SHEETS_SPREADSHEET_ID (from the sheet's URL),
//    GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
//    (the JSON's private_key field, \n-escaped is fine — this module
//    un-escapes it).

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export function googleSheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID &&
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  );
}

// Every function below takes an optional spreadsheetId, defaulting to the
// dispatch sheet's env var — existing callers are unaffected. Other sheets
// (e.g. the payments-tracking sheet in lib/finance/payments-sheet.ts) pass
// their own id explicitly; same service account, just needs Editor access
// shared on that sheet too.
function resolveSpreadsheetId(spreadsheetId?: string): string {
  const id = spreadsheetId || process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!id) throw new Error("No spreadsheetId given and GOOGLE_SHEETS_SPREADSHEET_ID is not set");
  return id;
}

function base64url(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const crypto = await import("node:crypto");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google token request failed: ${json.error_description || json.error || res.status}`);

  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

export async function listTabNames(spreadsheetId?: string): Promise<string[]> {
  const id = resolveSpreadsheetId(spreadsheetId);
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${id}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Sheets metadata read failed: ${json.error?.message || res.status}`);
  return (json.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title);
}

// Keyed by spreadsheetId — more than one sheet is read in-process now (the
// dispatch sheet and the payments sheet), each with its own tab names.
const cachedTabNamesBySheet = new Map<string, string[]>();

// Real tab titles can carry stray leading/trailing whitespace (this sheet
// has one literally named " Local orders") that silently 400s every API
// call if hardcoded wrong. Resolve by trimmed/case-insensitive match against
// the actual titles instead of assuming the logical name is the real one.
export async function resolveTabName(logicalName: string, spreadsheetId?: string): Promise<string> {
  const id = resolveSpreadsheetId(spreadsheetId);
  let cached = cachedTabNamesBySheet.get(id);
  if (!cached) {
    cached = await listTabNames(id);
    cachedTabNamesBySheet.set(id, cached);
  }
  const match = cached.find((t) => t.trim().toLowerCase() === logicalName.trim().toLowerCase());
  if (!match) throw new Error(`No tab found matching "${logicalName}" — actual tabs: ${cached.join(", ")}`);
  return match;
}

// Row 1 of a tab — used to auto-map fields to whatever columns actually
// exist rather than guessing a fixed column order against a live sheet the
// whole team edits.
export async function readHeaderRow(tabName: string, spreadsheetId?: string): Promise<string[]> {
  const id = resolveSpreadsheetId(spreadsheetId);
  const token = await getAccessToken();
  const range = encodeURIComponent(`${tabName}!1:1`);
  const res = await fetch(`${SHEETS_API}/${id}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Sheets header read failed (${tabName}): ${json.error?.message || res.status}`);
  return (json.values?.[0] ?? []) as string[];
}

// Whole tab, header row included — used to find already-existing order
// numbers before appending, so a system restart or backfill never creates a
// duplicate row next to one Sinan/Yaseen already has.
export async function readAllValues(tabName: string, spreadsheetId?: string): Promise<string[][]> {
  const id = resolveSpreadsheetId(spreadsheetId);
  const token = await getAccessToken();
  const range = encodeURIComponent(tabName);
  const res = await fetch(`${SHEETS_API}/${id}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Sheets full-tab read failed (${tabName}): ${json.error?.message || res.status}`);
  return (json.values ?? []) as string[][];
}

// Numeric sheetId (gid) by title — needed for structural operations
// (batchUpdate) that the values API's tab-name-in-range addressing can't do.
async function getSheetId(tabName: string, spreadsheetId?: string): Promise<number> {
  const id = resolveSpreadsheetId(spreadsheetId);
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${id}?fields=sheets.properties(sheetId,title)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Sheets metadata read failed: ${json.error?.message || res.status}`);
  const sheet = (json.sheets ?? []).find((s: { properties: { title: string; sheetId: number } }) => s.properties.title === tabName);
  if (!sheet) throw new Error(`No tab found matching "${tabName}" for sheetId lookup`);
  return sheet.properties.sheetId as number;
}

// Freezes row 1 so a manual "sort by column" in the Sheets UI can never drag
// the header into the data range — the exact failure mode that repeatedly
// corrupted the dispatch sheet's header (see the comment on
// appendOrderToDispatchSheet in dispatch-sheet.ts). A structural sheet
// setting, not a data write; safe to call repeatedly (idempotent).
export async function freezeHeaderRow(tabName: string, spreadsheetId?: string): Promise<void> {
  const id = resolveSpreadsheetId(spreadsheetId);
  const token = await getAccessToken();
  const sheetId = await getSheetId(tabName, spreadsheetId);
  const res = await fetch(`${SHEETS_API}/${id}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
      ],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Sheets freeze-header failed (${tabName}): ${json.error?.message || res.status}`);
}

export async function appendRow(tabName: string, row: (string | number)[], spreadsheetId?: string): Promise<void> {
  const id = resolveSpreadsheetId(spreadsheetId);
  const token = await getAccessToken();
  const range = encodeURIComponent(`${tabName}!A1`);
  const res = await fetch(`${SHEETS_API}/${id}/values/${range}:append?valueInputOption=USER_ENTERED`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Sheets append failed (${tabName}): ${json.error?.message || res.status}`);
}

// 0-indexed column -> spreadsheet letter (0 -> A, 25 -> Z, 26 -> AA, ...).
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Targeted single-cell writes into an EXISTING row (row is 1-indexed,
// matching the sheet's own row numbers — e.g. row 1 is the header). Used to
// fill in a handful of cells (payment confirmation) on a row this system
// already appended, without touching anything else a human has since edited
// on that row.
export async function updateCells(tabName: string, updates: { row: number; col: number; value: string }[], spreadsheetId?: string): Promise<void> {
  if (updates.length === 0) return;
  const id = resolveSpreadsheetId(spreadsheetId);
  const token = await getAccessToken();
  const data = updates.map((u) => ({
    range: `${tabName}!${columnLetter(u.col)}${u.row}`,
    values: [[u.value]],
  }));
  const res = await fetch(`${SHEETS_API}/${id}/values:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Sheets batch update failed (${tabName}): ${json.error?.message || res.status}`);
}
