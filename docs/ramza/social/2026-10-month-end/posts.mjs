/* RAMZA month-end carousels. One HTML page per post, each .slide 1080×1350,
 * rendered at 2× to PNG. Brand: white + navy #0B1533 / night #050B1F, ink
 * #14131C, hairlines #E3E7F0, Urbanist display + IBM Plex Sans. Small radii,
 * solid surfaces, real photos, real logos, real Omnia screens. No gradients,
 * glows, icon bubbles (founder rule). Figures: Omnia live data, Sept 2026. */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const W = "/Users/gaian/Projects/startups/omnia-finance-os/.worktrees/ramza-dev/public";
const IMG = path.resolve("img");
const OUT = process.argv[2];
const u = (p) => "file://" + p;
const photo = (n) => u(`${W}/ramza/photos/${n}.jpg`);
const shot = (n) => u(`${IMG}/${n}.png`);
const logo = {
  shopify: `${W}/gateways/shopify.svg`, stripe: `${W}/gateways/stripe.png`, tabby: `${W}/gateways/tabby.png`,
  tamara: `${W}/gateways/tamara.png`, telr: `${W}/gateways/telr.png`, checkout: `${W}/gateways/checkout.svg`,
  cod: `${W}/gateways/cod.svg`, zoho: `${W}/ramza/logos/zoho-books.svg`, gmail: `${W}/ramza/logos/gmail.svg`,
  drive: `${W}/ramza/logos/googledrive.svg`, telegram: `${W}/ramza/logos/telegram.svg`, whatsapp: `${W}/ramza/logos/whatsapp.svg`,
  woo: `${W}/ramza/logos/woocommerce.svg`,
};

const MARK = `<svg width="44" height="44" viewBox="0 0 28 28"><rect width="28" height="28" rx="8" fill="#14131C"/><rect x="6" y="9.5" width="12" height="3.2" rx="1.6" fill="#B3A6FF"/><rect x="10" y="15.3" width="12" height="3.2" rx="1.6" fill="#FFFFFF"/></svg>`;
const MARK_LIGHT = `<svg width="44" height="44" viewBox="0 0 28 28"><rect width="28" height="28" rx="8" fill="#FFFFFF"/><rect x="6" y="9.5" width="12" height="3.2" rx="1.6" fill="#B3A6FF"/><rect x="10" y="15.3" width="12" height="3.2" rx="1.6" fill="#0B1533"/></svg>`;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Urbanist:wght@500;600;700&display=block');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#888;font-family:'IBM Plex Sans',sans-serif;color:#14131C;-webkit-font-smoothing:antialiased}
.slide{width:1080px;height:1350px;position:relative;overflow:hidden;background:#fff;display:flex;flex-direction:column;margin-bottom:20px}
.dark{background:#0B1533;color:#fff}
.night{background:#050B1F;color:#fff}
.pad{padding:84px 84px 0;flex:1;display:flex;flex-direction:column}
.body{flex:1;display:flex;flex-direction:column;justify-content:center;padding-bottom:40px}
h1,h2{font-family:'Urbanist',sans-serif;letter-spacing:-0.025em}
h1{font-size:84px;line-height:1.02;font-weight:600}
h2{font-size:64px;line-height:1.06;font-weight:600}
.eyebrow{font-size:22px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:#5B6475}
.dark .eyebrow,.night .eyebrow{color:#9AA6C4}
.lead{font-size:32px;line-height:1.42;color:#4A5263}
.dark .lead,.night .lead{color:#C3CADB}
.foot{margin-top:auto;display:flex;align-items:center;gap:16px;padding:30px 84px;border-top:1px solid #E3E7F0;font-size:22px;color:#5B6475}
.dark .foot,.night .foot{border-color:rgba(255,255,255,.12);color:#9AA6C4}
.foot b{font-family:'Urbanist';font-size:26px;letter-spacing:.14em;color:#14131C;font-weight:700}
.dark .foot b,.night .foot b{color:#fff}
.foot .n{margin-left:auto;font-variant-numeric:tabular-nums}
.photo{width:100%;object-fit:cover;display:block}
.frame{border:1px solid #D9DEE8;border-radius:10px;overflow:hidden;background:#fff}
.frame img{display:block;width:100%}
.list{list-style:none}
.list li{display:flex;gap:30px;padding:38px 0;border-top:1px solid #E3E7F0;font-size:36px;line-height:1.35}
.dark .list li,.night .list li{border-color:rgba(255,255,255,.14)}
.list li .k{font-family:'Urbanist';font-weight:600;font-size:30px;padding-top:4px;color:#8A93A5;min-width:52px;font-variant-numeric:tabular-nums}
.list li strong{font-weight:600}
.tag{display:inline-block;align-self:flex-start;font-size:20px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:8px 14px;border:1.5px solid currentColor;border-radius:6px}
.logo{height:64px;width:auto;object-fit:contain}
.ltile{display:flex;align-items:center;justify-content:center;height:120px;border:1px solid #E3E7F0;border-radius:10px;background:#fff;padding:0 24px}
.cta{display:inline-flex;align-items:center;gap:14px;background:#fff;color:#0B1533;font-weight:600;font-size:30px;padding:24px 36px;border-radius:8px}
.cta.navy{background:#0B1533;color:#fff}
.stat{white-space:nowrap;font-family:'Urbanist';font-weight:600;font-size:80px;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums}
.chat{background:#fff;border-radius:12px;padding:36px;display:flex;flex-direction:column;gap:18px;color:#14131C}
.bubble{max-width:84%;padding:24px 28px;border-radius:12px;font-size:32px;line-height:1.4}
.q{align-self:flex-end;background:#E3EFFB}
.a{align-self:flex-start;background:#F3F4F7}
.a small{display:block;margin-top:10px;font-size:20px;color:#7A8294}
`;

const foot = (i, n, dark) => `<div class="foot">${dark ? MARK_LIGHT : MARK}<b>RAMZA</b><span>ramza.ai</span><span class="n">${i}/${n}</span></div>`;

/* cover: real photo on top, solid panel with the headline below */
const cover = ({ img, eyebrow, title, sub, pos = "center" }) => (i, n) => `
<div class="slide dark">
  <img class="photo" src="${img}" style="height:640px;object-position:${pos}">
  <div class="pad" style="padding-top:64px">
    <div class="eyebrow">${eyebrow}</div>
    <h1 style="margin-top:22px">${title}</h1>
    ${sub ? `<p class="lead" style="margin-top:26px">${sub}</p>` : ""}
  </div>
  ${foot(i, n, true)}
</div>`;

const listSlide = ({ eyebrow, title, items, after, dark }) => (i, n) => `
<div class="slide ${dark ? "dark" : ""}">
  <div class="pad">
    <div class="eyebrow">${eyebrow}</div>
    <h2 style="margin-top:22px">${title}</h2>
    <div class="body"><ul class="list">${items.map((t, k) => `<li><span class="k">0${k + 1}</span><span>${t}</span></li>`).join("")}</ul>
    ${after ? `<p class="lead" style="margin-top:36px">${after}</p>` : ""}</div>
  </div>
  ${foot(i, n, dark)}
</div>`;

const shotSlide = ({ eyebrow, title, img, note, width = 912 }) => (i, n) => `
<div class="slide" style="background:#F6F7F9">
  <div class="pad">
    <div class="eyebrow">${eyebrow}</div>
    <h2 style="margin-top:22px">${title}</h2>
    <div class="body"><div class="frame" style="width:${width}px">${img.map((s) => `<img src="${s}">`).join('<div style="height:1px;background:#E3E7F0"></div>')}</div>
    ${note ? `<p style="margin-top:30px;font-size:27px;line-height:1.4;color:#5B6475">${note}</p>` : ""}</div>
  </div>
  ${foot(i, n)}
</div>`;

const ctaSlide = ({ title, sub, btn = "Book a free readiness check" }) => (i, n) => `
<div class="slide night">
  <div class="pad" style="justify-content:center;padding-bottom:80px">
    ${MARK_LIGHT.replace('width="44" height="44"', 'width="96" height="96"')}
    <h2 style="margin-top:56px;font-size:76px">${title}</h2>
    <p class="lead" style="margin-top:30px">${sub}</p>
    <div style="margin-top:64px"><span class="cta">${btn} · ramza.ai</span></div>
  </div>
  ${foot(i, n, true)}
</div>`;

const logos = (keys) => keys.map(([k, label]) => `
  <div><div class="ltile"><img class="logo" src="${u(logo[k])}" style="${k === "woo" ? "height:120px" : ["tamara", "telr", "checkout", "zoho"].includes(k) ? "height:58px" : ""}"></div>
  <div style="margin-top:12px;font-size:21px;color:#5B6475">${label}</div></div>`).join("");

const POSTS = {
  "01-ecommerce-month-end": {
    caption: `Seven gateways, one bank statement, and a month to close.

Tabby and Tamara pay out net of fees, in batches. Stripe and Shopify Payments bundle dozens of orders into one credit. COD arrives from the courier minus delivery charges. KSA orders land in SAR. So one bank line almost never equals one order.

RAMZA traces every bank credit to the payout file that explains it and to the orders inside it. What doesn't match stays on a short list until someone resolves it. The month goes to your accountant as one close pack.

Free readiness check: ramza.ai

#ecommerce #UAE #KSA #monthend #accounting #reconciliation #ZohoBooks`,
    slides: [
      cover({ img: photo("px-studio-packing"), eyebrow: "For e-commerce brands", title: "Month end without the spreadsheet marathon.", sub: "Every bank credit traced to its payout and its orders.", pos: "center 35%" }),
      listSlide({
        eyebrow: "Why it takes so long", title: "One bank line is rarely one order.",
        items: [
          "<strong>Tabby and Tamara</strong> pay out net of fees, in batches.",
          "<strong>Stripe and Shopify Payments</strong> bundle dozens of orders into one credit.",
          "<strong>COD</strong> arrives from the courier minus delivery charges.",
          "<strong>KSA orders</strong> are paid in SAR and land in AED at the bank's rate.",
          "<strong>Refunds</strong> come out of the next payout, not the original order.",
        ],
      }),
      shotSlide({ eyebrow: "What RAMZA shows", title: "Where the month's money came from.", img: [shot("gateways")], note: "Omnia's September 2026 close, live data: each gateway's total and the share already matched to orders.", width: 912 }),
      shotSlide({ eyebrow: "Three steps", title: "Statement in. Files matched. Differences reviewed.", img: [shot("steps")], note: "Each step opens the credits it counts, so nobody hunts through the whole month.", width: 912 }),
      ctaSlide({ title: "See your own month, matched.", sub: "Send one bank statement and one payout file. We show you what RAMZA finds." }),
    ],
  },

  "02-accounting-firms": {
    caption: `Accounting firms closing e-commerce clients get the same pile every month: a bank PDF, five gateway exports, and a message saying "the rest is in the shared folder".

RAMZA reads bank statements in PDF, CSV or Excel, reads each gateway's payout file, and matches every credit to its orders. Your reviewer works from the short list of differences, not the whole month. Nothing is posted to Zoho Books until someone approves it.

Free readiness check: ramza.ai

#accountingfirm #bookkeeping #UAE #ecommerce #monthend #ZohoBooks`,
    slides: [
      cover({ img: photo("px-accountant-files"), eyebrow: "For accounting firms", title: "Your e-commerce clients, closed from the bank up.", pos: "center 40%" }),
      listSlide({
        eyebrow: "What arrives at month end", title: "Files in every format. None of them agree.",
        items: [
          "A bank statement as a PDF, a CSV or an Excel file.",
          "A payout export from each gateway, each in its own layout.",
          "Orders in Shopify or WooCommerce, invoices in Zoho Books.",
          "Questions about which credit paid which order.",
        ],
      }),
      listSlide({
        eyebrow: "What RAMZA does", title: "Reads them, matches them, shows the gaps.", dark: true,
        items: [
          "Reads the statement and every payout file, whatever the format.",
          "Matches each bank credit to its payout and the orders inside it.",
          "Separates fees, VAT on fees and exchange differences.",
          "Posts to Zoho Books only after your reviewer approves.",
        ],
      }),
      shotSlide({ eyebrow: "Review only the differences", title: "The month on one short list.", img: [shot("needs-file")], note: "Omnia, September 2026: 2 of 145 credits still waiting for a payout file.", width: 912 }),
      ctaSlide({ title: "Close more clients with the same team.", sub: "We set up your first client with you, on their real files." }),
    ],
  },

  "03-ai-cfo-telegram": {
    caption: `Ask your books a question the way you'd ask your accountant.

RAMZA's CFO bot answers in Telegram from your live, bank-checked data: how much a gateway paid, which payouts are still missing a file, what is overdue. Every evening it sends the day's summary.

WhatsApp is coming soon.

Free readiness check: ramza.ai

#AI #CFO #Telegram #ecommerce #UAE #finance`,
    slides: [
      cover({ img: photo("px-operator-desk"), eyebrow: "RAMZA CFO in Telegram", title: "Ask your books. Get the answer from the bank.", pos: "center 30%" }),
      (i, n) => `
<div class="slide dark">
  <div class="pad">
    <div style="display:flex;align-items:center;gap:16px"><img src="${u(logo.telegram)}" style="height:44px"><span class="eyebrow">Example questions · Omnia, Sept 2026</span></div>
    <h2 style="margin-top:22px">Plain questions. Exact figures.</h2>
    <div class="body"><div class="chat">
      <div class="bubble q">How much did Tabby pay us in September?</div>
      <div class="bubble a">AED 375,332.73 in 22 bank credits, covering 312 orders. All 22 are matched to their payout files.</div>
      <div class="bubble q">Which credits still need a payout file?</div>
      <div class="bubble a">Two: Tamara AED 8,219.81 on 22 Sep and Telr AED 25,585.24 on 14 Sep.<small>Figures from Omnia's live September 2026 close.</small></div>
    </div></div>
  </div>
  ${foot(i, n, true)}
</div>`,
      listSlide({
        eyebrow: "Without asking", title: "It tells you first.",
        items: [
          "<strong>Every evening:</strong> the day's sales, what reached the bank and what is still pending.",
          "<strong>Overdue payouts:</strong> a gateway that hasn't paid on time is flagged in the chat.",
          "<strong>Read-only:</strong> the bot answers from your data; it never posts to your books.",
        ],
      }),
      (i, n) => `
<div class="slide">
  <div class="pad">
    <div class="eyebrow">Next</div>
    <h2 style="margin-top:22px">The same CFO, in WhatsApp.</h2>
    <div class="body"><div style="display:flex;align-items:center;gap:36px;padding:56px;border:1px solid #E3E7F0;border-radius:10px">
      <img src="${u(logo.whatsapp)}" style="height:96px">
      <div><span class="tag" style="color:#0B1533">Coming soon</span>
      <p class="lead" style="margin-top:18px">Ask the same questions where your team already talks. Join early access at ramza.ai.</p></div>
    </div></div>
  </div>
  ${foot(i, n)}
</div>`,
      ctaSlide({ title: "Your numbers, one message away.", sub: "Connect your stores, gateways and bank. Ask in Telegram today." }),
    ],
  },

  "04-connections": {
    caption: `Connect once, and every source feeds the same month-end close.

Stores: Shopify and WooCommerce. Gateways: Tabby, Tamara, Stripe, Telr, Checkout.com, Shopify Payments and COD couriers. Books: Zoho Books. Payout emails: Gmail.

Google Drive folders are coming soon.

RAMZA reads first and posts nothing to your books without a click.

ramza.ai

#integrations #Shopify #ZohoBooks #Tabby #Tamara #Stripe #ecommerce #UAE`,
    slides: [
      cover({ img: photo("px-cafe-laptop"), eyebrow: "Connections", title: "Connect once. Close every month from it.", pos: "center 60%" }),
      (i, n) => `
<div class="slide">
  <div class="pad">
    <div class="eyebrow">What RAMZA reads</div>
    <h2 style="margin-top:22px">Your stores, gateways and books.</h2>
    <div class="body"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:30px 22px">
      ${logos([["shopify", "Shopify"], ["woo", "WooCommerce"], ["zoho", "Zoho Books"], ["tabby", "Tabby"], ["tamara", "Tamara"], ["stripe", "Stripe"], ["telr", "Telr"], ["checkout", "Checkout.com"], ["cod", "COD couriers"]])}
    </div></div>
  </div>
  ${foot(i, n)}
</div>`,
      (i, n) => `
<div class="slide">
  <div class="pad">
    <div class="eyebrow">Inbox and files</div>
    <h2 style="margin-top:22px">Payout emails, read for you.</h2>
    <div class="body"><div style="display:grid;grid-template-columns:1fr 1fr;gap:22px">
      <div style="border:1px solid #E3E7F0;border-radius:10px;padding:40px"><img src="${u(logo.gmail)}" style="height:64px"><div style="margin-top:26px;font-size:34px;font-weight:600">Gmail</div><p style="margin-top:12px;font-size:29px;line-height:1.4;color:#4A5263">Payout files that arrive by email are picked up and matched to the bank.</p></div>
      <div style="border:1px solid #E3E7F0;border-radius:10px;padding:40px"><img src="${u(logo.drive)}" style="height:64px"><div style="margin-top:26px;font-size:34px;font-weight:600">Google Drive</div><p style="margin-top:12px;font-size:29px;line-height:1.4;color:#4A5263">Point RAMZA at a folder of statements.</p><div style="margin-top:18px"><span class="tag" style="color:#0B1533">Coming soon</span></div></div>
    </div></div>
  </div>
  ${foot(i, n)}
</div>`,
      listSlide({
        eyebrow: "Safe by default", title: "It reads first. You decide what's posted.", dark: true,
        items: [
          "Every figure is checked against the bank statement.",
          "Nothing is posted to Zoho Books without a click on the chosen lines.",
          "Every posting keeps its bank reference, so the trail is complete.",
        ],
      }),
      ctaSlide({ title: "Bring the sources you already use.", sub: "We connect them with you on a short call." }),
    ],
  },

  "05-documents-any-format": {
    caption: `Statements and payout files come in every format: PDF, CSV, Excel.

RAMZA reads them as they are. Upload a bank statement and each credit waits for the payout file that explains it. Payout files sent to your Gmail are picked up on their own.

Coming soon: RAMZA agents that ask your team or your client for the document that's missing, and Google Drive folders.

ramza.ai

#accounting #documents #automation #AI #ecommerce #UAE`,
    slides: [
      cover({ img: photo("px-statements-calculator"), eyebrow: "Documents", title: "Any statement. Any format. Read as it is.", pos: "center 50%" }),
      listSlide({
        eyebrow: "What RAMZA reads today", title: "No reformatting, no copy and paste.",
        items: [
          "<strong>Bank statements</strong> as PDF, CSV, TXT or Excel, by account.",
          "<strong>Payout files</strong> from Tabby, Tamara, Stripe, Telr, Checkout and Shopify Payments.",
          "<strong>Courier COD vouchers</strong>, with delivery charges split out.",
          "<strong>Payout emails</strong> in Gmail, picked up as they arrive.",
        ],
      }),
      shotSlide({ eyebrow: "When a file is missing", title: "The gap is named, with the amount.", img: [shot("needs-file")], note: "Omnia, September 2026. One click uploads the missing file against that credit.", width: 912 }),
      (i, n) => `
<div class="slide dark">
  <div class="pad">
    <span class="tag" style="color:#fff">Coming soon</span>
    <h2 style="margin-top:30px">RAMZA agents that ask for what's missing.</h2>
    <div class="body"><ul class="list">
      <li><span class="k">01</span><span>A credit has no payout file: the agent asks the right person for it.</span></li>
      <li><span class="k">02</span><span>The reply arrives in any format: it is read and matched.</span></li>
      <li><span class="k">03</span><span>Google Drive folders are watched for new statements.</span></li>
    </ul>
    <p class="lead" style="margin-top:36px">Join early access at ramza.ai.</p></div>
  </div>
  ${foot(i, n, true)}
</div>`,
      ctaSlide({ title: "Send us last month's files.", sub: "We'll show you what RAMZA reads and what it finds." }),
    ],
  },

  "06-case-study-omnia": {
    caption: `Case study: how Omnia closes the month in RAMZA.

Omnia sells across the UAE and KSA and gets paid through seven gateways. In September 2026 RAMZA checked AED 1.42m of sales money against the bank and traced 1,173 orders to the payout files that paid them, including 22 payouts in foreign currency matched at the bank's own rate.

No spreadsheet is rebuilt at month end. Every credit opens to its payout and its orders, and differences stay listed until they're resolved.

Omnia Stores is RAMZA's founding company and first user.

ramza.ai

#casestudy #ecommerce #UAE #KSA #monthend #reconciliation`,
    slides: [
      (i, n) => `
<div class="slide dark">
  <div class="pad">
    <div class="eyebrow">Case study · Omnia Stores</div>
    <h1 style="margin-top:22px">How Omnia closes the month without a spreadsheet.</h1>
    <div class="body"><div class="frame" style="border-color:rgba(255,255,255,.2)"><img src="${shot("money")}"></div>
    <p style="margin-top:24px;font-size:25px;color:#9AA6C4">Omnia's real September 2026 close in RAMZA.</p></div>
  </div>
  ${foot(i, n, true)}
</div>`,
      (i, n) => `
<div class="slide">
  <div class="pad">
    <div class="eyebrow">September 2026, live data</div>
    <h2 style="margin-top:22px">One month, in numbers.</h2>
    <div class="body"><div style="display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #E3E7F0">
      ${[["AED 1.42m", "sales money checked against the bank"], ["1,173", "orders traced to the payout that paid them"], ["7", "gateways in one close"], ["22", "foreign-currency payouts matched at the bank's rate"]].map(([v, l], k) => `
      <div style="padding:44px ${k % 2 ? "0 44px 44px" : "44px 44px 0"};border-bottom:1px solid #E3E7F0;${k % 2 ? "border-left:1px solid #E3E7F0;padding-left:44px" : "padding-left:0"}">
        <div class="stat" style="color:#0B1533">${v}</div><div style="margin-top:16px;font-size:29px;line-height:1.35;color:#4A5263">${l}</div></div>`).join("")}
    </div></div>
  </div>
  ${foot(i, n)}
</div>`,
      shotSlide({ eyebrow: "By gateway", title: "Seven gateways, one screen.", img: [shot("gateways")], note: "Tabby and Shopify Payments fully matched; the rest show exactly what is left.", width: 912 }),
      listSlide({
        eyebrow: "What changed for Omnia", title: "Month end, without the rebuild.",
        items: [
          "<strong>No spreadsheet to rebuild:</strong> statement, payout files and orders meet in one screen.",
          "<strong>Every credit answers itself:</strong> open it and see its payout and its orders.",
          "<strong>Differences stay visible</strong> until someone resolves them.",
          "<strong>One close pack</strong> goes to the accountant.",
        ],
        after: "Omnia Stores is RAMZA's founding company and first user.",
      }),
      ctaSlide({ title: "Your month could look like this.", sub: "Free readiness check on your own files." }),
    ],
  },
};

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "/Users/gaian/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" });
const page = await (await browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 })).newPage();
const only = process.argv[3];
for (const [name, post] of Object.entries(POSTS)) {
  if (only && !name.startsWith(only)) continue;
  const n = post.slides.length;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${post.slides.map((s, k) => s(k + 1, n)).join("")}</body></html>`;
  const file = path.resolve(`html/${name}.html`);
  fs.mkdirSync("html", { recursive: true });
  fs.writeFileSync(file, html);
  await page.goto("file://" + file, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const dir = `${OUT}/${name}`;
  fs.mkdirSync(dir, { recursive: true });
  const slides = await page.$$(".slide");
  for (let k = 0; k < slides.length; k++) await slides[k].screenshot({ path: `${dir}/slide-${k + 1}.png` });
  fs.writeFileSync(`${dir}/caption.txt`, post.caption);
  console.log(name, slides.length);
}
await browser.close();
