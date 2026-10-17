/* Capture real proof for a video from the running app (start it with
 * OMNIA_DISABLE_SCHEDULERS=1 npx next dev -p 3456 so it doesn't fight the
 * live bots). Usage: node capture.mjs <projectDir> <YYYY-MM>
 * Writes SHOT/close.png, needs-file.png, to-check.png, zoho-ledger.png and
 * data/recon.json + sheetdata.js (real rows, long digit runs masked, owner
 * transfers left out). Never capture the Zoho books / Bank lines tabs for a
 * public video: they show customer and payee names. */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
// Playwright's own browser if installed, else a cached Chrome for Testing, else $CHROME_PATH
const CACHED = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CHROME = process.env.CHROME_PATH ?? (existsSync(CACHED) ? CACHED : undefined);
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const [dir, month] = process.argv.slice(2);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const token = execSync(`node ${HERE}/tok.mjs`).toString().trim();
const base = process.env.APP_URL ?? "http://localhost:3456";
const [y, m] = month.split("-").map(Number);
const last = new Date(y, m, 0).getDate();
const from = `${month}-01`, to = `${month}-${String(last).padStart(2, "0")}`;

const res = await fetch(`${base}/api/reconcile?from=${from}&to=${to}`, { headers: { cookie: `omnia_session=${token}` } });
const recon = await res.json();
fs.writeFileSync(`${dir}/data/recon.json`, JSON.stringify(recon));
const L = recon.lines.filter((l) => l.provider !== "Unclassified").sort((a, b) => a.date.localeCompare(b.date) || b.bankAmount - a.bankAmount);
const mask = (t) => t.replace(/\d{6,}/g, (d) => d.slice(0, 3) + "•••" + d.slice(-2));
const stripe = L.find((l) => l.provider === "Stripe") ?? L[0];
const sheet = {
  bank: L.slice(0, 22).map((l) => ({ d: l.date.slice(0, 10), n: mask(l.narration).slice(0, 64), a: l.bankAmount, p: l.provider })),
  tx: stripe.transactions.slice(0, 18).map((t) => ({ r: t.ref, g: t.grossShare, f: t.feeShare })),
  stripeBank: stripe.bankAmount,
  facts: {
    credits: L.length, totalAed: L.reduce((s, l) => s + l.bankAmount, 0),
    orders: new Set(L.flatMap((l) => l.resolvedOrders)).size,
    payoutFiles: new Set(L.filter((l) => l.payout).map((l) => l.payout.id)).size,
    gateways: [...new Set(L.map((l) => l.provider))],
  },
};
fs.writeFileSync(`${dir}/sheetdata.js`, "window.SHEET = " + JSON.stringify(sheet) + ";");
console.log("facts", sheet.facts);

const b = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}) });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "omnia_session", value: token, url: base }]);
const p = await ctx.newPage();
await p.addInitScript(() => addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(s); }));
await p.goto(`${base}/reconciliation`, { waitUntil: "domcontentloaded" });
await p.waitForSelector("text=Sales money in the bank", { timeout: 180000 });
await p.waitForTimeout(2500);
// step back from the current month to the requested one
const now = new Date();
for (let k = (now.getFullYear() - y) * 12 + now.getMonth() + 1 - m; k > 0; k--) { await p.click('[aria-label="Previous month"]'); await p.waitForTimeout(2500); }
await p.mouse.move(5, 990); await p.waitForTimeout(1000);
await p.screenshot({ path: `${dir}/SHOT/close.png` });
await p.locator("li", { hasText: "Payout files" }).locator("button[aria-pressed]").click().catch(() => {});
await p.waitForTimeout(1200); await p.screenshot({ path: `${dir}/SHOT/needs-file.png` });
await p.locator("li", { hasText: "Review differences" }).locator("button[aria-pressed]").click().catch(() => {});
await p.waitForTimeout(1200); await p.screenshot({ path: `${dir}/SHOT/to-check.png` });
await p.getByRole("button", { name: "Zoho ledger", exact: true }).click();
await p.waitForTimeout(16000); await p.screenshot({ path: `${dir}/SHOT/zoho-ledger.png` });
await b.close();
fs.copyFileSync(`${dir}/SHOT/close.png`, `${dir}/SHOT/omnia-sep-full.png`); // templates reference this name
// Zoho ledger crops used by templates/before-after.html (measured on the 1600×1000 @2x layout;
// re-check them in a check frame if the Ledger tab layout changes)
execSync(`ffmpeg -y -loglevel error -i ${dir}/SHOT/zoho-ledger.png -vf "crop=1344:512:528:960" ${dir}/SHOT/zoho-remaining.png`);
execSync(`ffmpeg -y -loglevel error -i ${dir}/SHOT/zoho-ledger.png -vf "crop=1100:420:2030:1500" ${dir}/SHOT/zoho-checklist.png`);
console.log("screens in", `${dir}/SHOT`);
