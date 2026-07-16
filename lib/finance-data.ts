// export type Gateway =
//   | "Stripe"
//   | "Telr"
//   | "Checkout"
//   | "Tabby"
//   | "Tamara"
//   | "Shopify Payments"
//   | "COD"
//   | "Unclassified";
// export type BankTransaction = {
//   id: string;
//   date: string;
//   narration: string;
//   reference: string;
//   debit: number;
//   credit: number;
//   balance: number;
//   provider: Gateway;
//   eligible: boolean;
//   reason: string;
// };
// export type Order = {
//   id: string;
//   number: string;
//   store: "WA" | "UAE" | "KSA";
//   date: string;
//   customer: string;
//   email: string;
//   country: string;
//   city: string;
//   currency: string;
//   grossOriginal: number;
//   amount: number;
//   subtotal: number;
//   shipping: number;
//   tax: number;
//   discount: number;
//   gatewayRaw: string;
//   gateway: Gateway;
//   payment: string;
//   courier: "Ontrack" | "SMSA";
//   outstanding: number;
// };

// export const statementSource = {
//   label: "Real sample",
//   name: "OMNIASTORES LLC bank statement",
//   period: "01–30 Jun 2026",
//   account: "•••• 8001",
//   iban: "AE45 •••• •••• •••• 98001",
//   branch: "Sheikh Zayed Road",
//   currency: "AED",
//   importedAt: "14 Jul 2026, 09:42 GST",
// };
// export const orderSource = {
//   label: "Real sample",
//   name: "Omnia consolidated orders export",
//   period: "12–13 Jul 2026",
//   importedAt: "14 Jul 2026, 09:44 GST",
// };

// const debit = (
//   id: string,
//   narration: string,
//   reference: string,
//   amount: number,
//   balance: number,
// ): BankTransaction => ({
//   id,
//   date: "30 Jun 2026",
//   narration,
//   reference,
//   debit: amount,
//   credit: 0,
//   balance,
//   provider: "Unclassified",
//   eligible: false,
//   reason: "Bank debit — an outflow, not a gateway settlement credit",
// });
// export const bankTransactions: BankTransaction[] = [
//   debit(
//     "B001",
//     "Outward Telex Payment / MUHAMMED ABDULLA / To AE53••0001",
//     "FT26181Q9707\\HCP",
//     7000,
//     662648.79,
//   ),
//   debit(
//     "B002",
//     "Fees or Charges / 0012043598001",
//     "FT26181Q9707\\HCP",
//     0.48,
//     669648.79,
//   ),
//   debit(
//     "B003",
//     "Tax Amount Payable / AC-0012043598001",
//     "FT26181Q9707\\HCP",
//     0.02,
//     669649.27,
//   ),
//   debit(
//     "B004",
//     "Outward Telex Payment / Moneeb Gul Ajab Gul / To AE82••7357",
//     "FT2618164F26\\HCP",
//     4000,
//     669649.29,
//   ),
//   debit(
//     "B005",
//     "Fees or Charges / 0012043598001",
//     "FT2618164F26\\HCP",
//     0.48,
//     673649.29,
//   ),
//   debit(
//     "B006",
//     "Tax Amount Payable / AC-0012043598001",
//     "FT2618164F26\\HCP",
//     0.02,
//     673649.77,
//   ),
//   debit(
//     "B007",
//     "Outward Telex Payment / Rembrandt Delfino / To AE44••5101",
//     "FT26181DBDXG\\HCP",
//     6000,
//     673649.79,
//   ),
//   debit(
//     "B008",
//     "Fees or Charges / 0012043598001",
//     "FT26181DBDXG\\HCP",
//     0.48,
//     679649.79,
//   ),
//   debit(
//     "B009",
//     "Tax Amount Payable / AC-0012043598001",
//     "FT26181DBDXG\\HCP",
//     0.02,
//     679650.27,
//   ),
//   debit(
//     "B010",
//     "Outward Telex Payment / Louis III C. Bumanglag / To AE71••4403",
//     "FT26181464NC\\HCP",
//     5000,
//     679650.29,
//   ),
//   debit(
//     "B011",
//     "Fees or Charges / 0012043598001",
//     "FT26181464NC\\HCP",
//     0.48,
//     684650.29,
//   ),
//   debit(
//     "B012",
//     "Tax Amount Payable / AC-0012043598001",
//     "FT26181464NC\\HCP",
//     0.02,
//     684650.77,
//   ),
//   debit(
//     "B013",
//     "Outward Telex Payment / John Troy Principe / To AE86••9201",
//     "FT2618158KR8\\HCP",
//     4000,
//     684650.79,
//   ),
//   debit(
//     "B014",
//     "Fees or Charges / 0012043598001",
//     "FT2618158KR8\\HCP",
//     0.48,
//     688650.79,
//   ),
//   debit(
//     "B015",
//     "Tax Amount Payable / AC-0012043598001",
//     "FT2618158KR8\\HCP",
//     0.02,
//     688651.27,
//   ),
//   debit(
//     "B016",
//     "IBK Other Bank Trans Debit / Joyalukkas Exchange / Sal HOM",
//     "FT26181HDHGV",
//     77156.25,
//     688651.29,
//   ),
//   debit(
//     "B017",
//     "Account Transfer Charges / IBMB / 0012043598001",
//     "FT26181HDHGV",
//     1,
//     765807.54,
//   ),
//   debit(
//     "B018",
//     "Tax Amount Payable / AC-0012043598001",
//     "FT26181HDHGV",
//     0.05,
//     765808.54,
//   ),
//   debit(
//     "B019",
//     "Outward Telex Payment / AHMED MOHAMED ZAKI HASSABALLAH / To AE29••0001",
//     "FT26181XLP3G\\HCP",
//     6000,
//     765808.59,
//   ),
//   debit(
//     "B020",
//     "Fees or Charges / 0012043598001",
//     "FT26181XLP3G\\HCP",
//     0.48,
//     771808.59,
//   ),
// ];

// const rows = [
//   [
//     "WA_7088352657595",
//     "5204",
//     "WA",
//     "Jawaher .",
//     "Juwahralnuaimi@gmail.com",
//     "QA",
//     "Doha",
//     "AED",
//     1040,
//     900,
//     95,
//     45,
//     0,
//     "Pay By Stripe",
//     "Stripe",
//     "paid",
//     "SMSA",
//     1040,
//   ],
//   [
//     "UAE_6818557984926",
//     "3347",
//     "UAE",
//     "مها جمعة",
//     "maha.essa89@gmail.com",
//     "AE",
//     "دبي",
//     "AED",
//     2413.5,
//     2270,
//     30,
//     113.5,
//     0,
//     "Cash on Delivery (COD)",
//     "COD",
//     "cod_pending",
//     "Ontrack",
//     2413.5,
//   ],
//   [
//     "WA_7088277061819",
//     "5203",
//     "WA",
//     "رقيه .",
//     "ruqayaabdu@gmail.com",
//     "AE",
//     "الوثبه",
//     "AED",
//     891,
//     820,
//     30,
//     41,
//     0,
//     "Pay By Tammara",
//     "Tamara",
//     "paid",
//     "Ontrack",
//     891,
//   ],
//   [
//     "KSA_6651813003318",
//     "3646",
//     "KSA",
//     "مشاعل العتيبي",
//     "thwabaltyby9@gmail.com",
//     "SA",
//     "الطائف",
//     "SAR",
//     901.09,
//     805.8,
//     55,
//     40.29,
//     0,
//     "Tabby",
//     "Tabby",
//     "paid",
//     "SMSA",
//     0,
//   ],
//   [
//     "KSA_6651786166326",
//     "3645",
//     "KSA",
//     "Sarah Abdulshafi",
//     "sarona_1999@proton.me",
//     "SA",
//     "Riyadh",
//     "SAR",
//     997.48,
//     897.6,
//     55,
//     44.88,
//     0,
//     "Checkout.com - Onsite Payments",
//     "Checkout",
//     "paid",
//     "SMSA",
//     0,
//   ],
//   [
//     "WA_7087926706363",
//     "5202",
//     "WA",
//     "الجازي محمد شمس",
//     "aljazyshams@gmail.com",
//     "QA",
//     "Doha",
//     "AED",
//     914,
//     780,
//     95,
//     39,
//     0,
//     "Pay By Stripe",
//     "Stripe",
//     "paid",
//     "SMSA",
//     914,
//   ],
//   [
//     "KSA_6651663941686",
//     "3644",
//     "KSA",
//     "هند النعمان",
//     "alnomanhend@gmail.com",
//     "SA",
//     "جدة",
//     "SAR",
//     1027.26,
//     925.96,
//     55,
//     46.3,
//     0,
//     "Checkout.com - Onsite Payments",
//     "Checkout",
//     "paid",
//     "SMSA",
//     0,
//   ],
//   [
//     "WA_7087243657403",
//     "5201",
//     "WA",
//     "ABDU Nasar",
//     "Tnaser77@gmail.com",
//     "AE",
//     "Alsufoh 1",
//     "AED",
//     12178.5,
//     11570,
//     30,
//     578.5,
//     0,
//     "Cash on Delivery (COD)",
//     "COD",
//     "cod_pending",
//     "Ontrack",
//     12178.5,
//   ],
//   [
//     "UAE_6817689469086",
//     "3346",
//     "UAE",
//     "ريم الدرعي",
//     "reem.matar1987@icloud.com",
//     "AE",
//     "العين",
//     "AED",
//     2592,
//     2440,
//     30,
//     122,
//     0,
//     "Tabby",
//     "Tabby",
//     "paid",
//     "Ontrack",
//     0,
//   ],
//   [
//     "KSA_6650253901878",
//     "3643",
//     "KSA",
//     "سارة خلف",
//     "s2a2ar@hotmail.com",
//     "SA",
//     "الرياض",
//     "SAR",
//     890.38,
//     795.6,
//     55,
//     39.78,
//     0,
//     "Tamara Split Payments",
//     "Tamara",
//     "paid",
//     "SMSA",
//     0,
//   ],
//   [
//     "KSA_6650249642038",
//     "3642",
//     "KSA",
//     "Renad Ahmed",
//     "renad.3793@gmail.com",
//     "SA",
//     "Abha",
//     "SAR",
//     1179.55,
//     1071,
//     55,
//     53.55,
//     0,
//     "Checkout.com - Onsite Payments",
//     "Checkout",
//     "paid",
//     "SMSA",
//     0,
//   ],
//   [
//     "UAE_6817513111710",
//     "3345",
//     "UAE",
//     "Salama Juma",
//     "ssjuma73@gmail.com",
//     "AE",
//     "Abu Dhabi",
//     "AED",
//     1668,
//     1560,
//     30,
//     78,
//     0,
//     "shopify_payments",
//     "Shopify Payments",
//     "paid",
//     "Ontrack",
//     0,
//   ],
//   [
//     "WA_7085573537979",
//     "5200",
//     "WA",
//     "ابتهال احمد سالم",
//     "iamibti@gmail.com",
//     "AE",
//     "مدينة محمد بن زايد",
//     "AED",
//     870,
//     800,
//     30,
//     40,
//     0,
//     "Pay By Stripe",
//     "Stripe",
//     "paid",
//     "Ontrack",
//     870,
//   ],
//   [
//     "KSA_6650019217462",
//     "3641",
//     "KSA",
//     "عبير خالد عبير خالد",
//     "abeer368@gmail.com",
//     "SA",
//     "Riyadh",
//     "SAR",
//     2721.79,
//     2539.8,
//     55,
//     126.99,
//     0,
//     "Checkout.com - Onsite Payments",
//     "Checkout",
//     "paid",
//     "SMSA",
//     0,
//   ],
//   [
//     "UAE_6817358545054",
//     "3344",
//     "UAE",
//     "Salama Alharmoodi",
//     "3ainawyaaa@gmail.com",
//     "AE",
//     "ندالحمر",
//     "AED",
//     859.5,
//     790,
//     30,
//     39.5,
//     0,
//     "Tabby",
//     "Tabby",
//     "paid",
//     "Ontrack",
//     0,
//   ],
//   [
//     "KSA_6650005094454",
//     "3640",
//     "KSA",
//     "ام سعود البدر",
//     "mada995@hotmail.com",
//     "SA",
//     "الرياض",
//     "SAR",
//     783.28,
//     693.6,
//     55,
//     34.68,
//     0,
//     "Tamara Split Payments",
//     "Tamara",
//     "paid",
//     "SMSA",
//     0,
//   ],
//   [
//     "KSA_6649882869814",
//     "3639",
//     "KSA",
//     "نوره حسن",
//     "noneta22015@gmail.com",
//     "SA",
//     "جدة",
//     "SAR",
//     1864.99,
//     1723.8,
//     55,
//     86.19,
//     0,
//     "Tabby,Tamara Split Payments",
//     "Tabby",
//     "paid",
//     "SMSA",
//     0,
//   ],
//   [
//     "KSA_6649783124022",
//     "3638",
//     "KSA",
//     "Noura AlJuwaidi",
//     "noura.aljuwaidi@live.com",
//     "SA",
//     "Riyadh",
//     "SAR",
//     1932.8,
//     1788.38,
//     55,
//     89.42,
//     0,
//     "Checkout.com - Onsite Payments",
//     "Checkout",
//     "paid",
//     "SMSA",
//     0,
//   ],
//   [
//     "UAE_6817039646878",
//     "3343",
//     "UAE",
//     "Ali Haider",
//     "3loo.breezy@gmail.com",
//     "AE",
//     "Dubai",
//     "AED",
//     1132.5,
//     1050,
//     30,
//     52.5,
//     0,
//     "shopify_payments",
//     "Shopify Payments",
//     "paid",
//     "Ontrack",
//     0,
//   ],
//   [
//     "KSA_6649509740598",
//     "3637",
//     "KSA",
//     "Shosh Almalki",
//     "shalmalki.almalki43@gmail.com",
//     "SA",
//     "مكة",
//     "SAR",
//     1864.99,
//     1723.8,
//     55,
//     86.19,
//     0,
//     "Tamara Split Payments",
//     "Tamara",
//     "paid",
//     "SMSA",
//     0,
//   ],
//   [
//     "WA_7084848644283",
//     "5199",
//     "WA",
//     "حمده .",
//     "Hamda-m1@hotmail.com",
//     "AE",
//     "Al Ain",
//     "AED",
//     2298,
//     2160,
//     30,
//     108,
//     240,
//     "Pay By Stripe",
//     "Stripe",
//     "paid",
//     "Ontrack",
//     2298,
//   ],
//   [
//     "WA_7084717441211",
//     "5198",
//     "WA",
//     "Iqbal Alfi Alfi",
//     "dabdoop2011@gmail.com",
//     "SA",
//     "Makkah",
//     "AED",
//     1703.5,
//     1570,
//     55,
//     78.5,
//     0,
//     "Pay by Checkout.com",
//     "Checkout",
//     "paid",
//     "SMSA",
//     1703.5,
//   ],
//   [
//     "KSA_6649069764662",
//     "3632",
//     "KSA",
//     "Najlaa Alamoudi",
//     "najlaa.saklou@gmail.com",
//     "SA",
//     "جدة",
//     "SAR",
//     5960.41,
//     5624.2,
//     55,
//     281.21,
//     1020,
//     "Tamara Split Payments",
//     "Tamara",
//     "paid",
//     "SMSA",
//     0,
//   ],
//   [
//     "UAE_6816588595358",
//     "3342",
//     "UAE",
//     "فاطمه عبدالله ال علي",
//     "sanaa2020uae@gmail.com",
//     "AE",
//     "الفجيره",
//     "AED",
//     2917.5,
//     2750,
//     30,
//     137.5,
//     0,
//     "Tabby",
//     "Tabby",
//     "paid",
//     "Ontrack",
//     0,
//   ],
//   [
//     "UAE_6816257802398",
//     "3341",
//     "UAE",
//     "Amal Mob Amal Mob",
//     "cailovemusic@gmail.com",
//     "SA",
//     "Jeddah",
//     "SAR",
//     914.19,
//     816.64,
//     56.72,
//     40.83,
//     0,
//     "shopify_payments",
//     "Shopify Payments",
//     "paid",
//     "SMSA",
//     0,
//   ],
//   [
//     "WA_7083760189627",
//     "5197",
//     "WA",
//     "BLACK TIGER",
//     "Black.tiger.libyaa@gmail.com",
//     "AE",
//     "Dubai",
//     "AED",
//     901.5,
//     830,
//     30,
//     41.5,
//     0,
//     "Pay By Stripe",
//     "Stripe",
//     "paid",
//     "Ontrack",
//     901.5,
//   ],
// ] as const;
// export const orders: Order[] = rows.map((r, i) => ({
//   id: r[0],
//   number: r[1],
//   store: r[2],
//   date: i < 13 ? "2026-07-13" : "2026-07-12",
//   customer: r[3],
//   email: r[4],
//   country: r[5],
//   city: r[6],
//   currency: r[7],
//   grossOriginal: r[8],
//   amount: r[8],
//   subtotal: r[9],
//   shipping: r[10],
//   tax: r[11],
//   discount: r[12],
//   gatewayRaw: r[13],
//   gateway: r[14],
//   payment: r[15],
//   courier: r[16],
//   outstanding: r[17],
// }));

// export const descriptorRules = [
//   {
//     raw: "NETWORK / STRIPE",
//     provider: "Stripe",
//     rule: "Contains NETWORK or STRIPE",
//   },
//   {
//     raw: "INNOVATE / TELR",
//     provider: "Telr",
//     rule: "Contains INNOVATE or TELR",
//   },
//   { raw: "TAMARA", provider: "Tamara", rule: "Contains TAMARA" },
//   { raw: "TABBY", provider: "Tabby", rule: "Contains TABBY" },
//   { raw: "CHECKOUT.COM", provider: "Checkout", rule: "Contains CHECKOUT" },
// ];
// export const stats = {
//   debits: bankTransactions.reduce((s, x) => s + x.debit, 0),
//   credits: 0,
//   orders: orders.length,
//   gross: orders.reduce((s, x) => s + x.amount, 0),
//   eligible: 0,
// };

// function getProvider(tx: BankTransaction): Gateway {
//     const text = tx.narration.toUpperCase();

//     if (text.includes("TAMARA"))
//         return "Tamara";

//     if (text.includes("CHECKOUT"))
//         return "Checkout";

//     if (text.includes("INNOVATE"))
//         return "Telr";

//     if (text.includes("NETWORK"))
//         return "Stripe";

//     if (text.includes("SABB"))
//         return "Tabby";

//     if (text.includes("SHOPIFY"))
//         return "Shopify Payments";

//     return "Unclassified";
// }

// function isSettlement(tx: BankTransaction) {
//     return tx.credit > 0;
// }
// export const stores = [
//   { code: "WA", name: "WhatsApp Shopify" },
//   { code: "UAE", name: "UAE Shopify" },
//   { code: "KSA", name: "KSA Shopify" },
//   { code: "WOO", name: "WooCommerce" },
// ];
// export const gatewayTotals = [
//   "Stripe",
//   "Checkout",
//   "Tabby",
//   "Tamara",
//   "Shopify Payments",
//   "COD",
// ].map((name) => ({
//   name,
//   value: orders
//     .filter((o) => o.gateway === name)
//     .reduce((s, o) => s + o.amount, 0),
//   color: "var(--chart-1)",
// }));
// export const revenueTrend = [
//   {
//     day: "Jul 12",
//     revenue: orders
//       .filter((o) => o.date.endsWith("12"))
//       .reduce((s, o) => s + o.amount, 0),
//     bank: 0,
//   },
//   {
//     day: "Jul 13",
//     revenue: orders
//       .filter((o) => o.date.endsWith("13"))
//       .reduce((s, o) => s + o.amount, 0),
//     bank: 0,
//   },
// ];
// export const payouts = descriptorRules.map((x, i) => ({
//   id: `PO-${4800 + i}`,
//   gateway: x.provider,
//   date: "Pending source data",
//   gross: 0,
//   fees: 0,
//   net: 0,
//   status: "Awaiting import",
//   bank: "—",
//   orders: orders.filter((o) => o.gateway === x.provider).length,
// }));

// export const expectedPayouts = bankTransactions.filter(isSettlement).map((tx) => ({
//   id: tx.id,
//   date: tx.date,
//   narration: tx.narration,
//   provider: getProvider(tx),
//   amount: tx.credit,
//   reference: tx.reference,
//   eligible: tx.eligible,
// }));
// export const returns = orders
//   .slice(0, 4)
//   .map((o, i) => ({
//     id: `RET-${2081 - i}`,
//     order: o.number,
//     customer: o.customer,
//     store: o.store,
//     amount: o.amount,
//     reason: "Not provided in source",
//     status: "Review",
//     updated: o.date,
//   }));
// export const aed = (v: number) =>
//   new Intl.NumberFormat("en-AE", {
//     style: "currency",
//     currency: "AED",
//     maximumFractionDigits: 0,
//   }).format(v);
// export const exactAed = (v: number) =>
//   new Intl.NumberFormat("en-AE", {
//     style: "currency",
//     currency: "AED",
//     minimumFractionDigits: 2,
//   }).format(v);

//   export const reconciliationLines =
//   bankTransactions
//       .filter(isSettlement)
//       .map((tx) => ({
//         id: tx.id,
//         date: tx.date,
//         narration: tx.narration,
//         provider: getProvider(tx),
//         amount: tx.credit,
//         reference: tx.reference,
//         eligible: tx.eligible,
//         status: "Settled",
//       }));



// ─────────────────────────────────────────────────────────────────────────────
// Omnia Finance OS — canonical data model
//
// ONE PRINCIPLE: Bank is the only source of truth.
// Reconciliation runs   BANK CREDIT → PAYOUT FILE → ORDERS   (never order → bank).
//
//   BANK CREDIT (truth)
//        ↓ must be explained by
//   PAYOUT FILE  (Stripe payout_id / Telr "Payout ID" banner)
//        ↓ resolves to
//   ORDER NUMBERS (Stripe: description parse via n8n · Telr: CartID prefix)
//        ↓ stamps
//   ORDER.settledByPayoutId   ← the ONLY way an order becomes "Settled"
//
// An order NEVER claims it settled itself. It waits to be claimed by a
// bank-confirmed payout. Anything a payout can't explain is an exception.
// ─────────────────────────────────────────────────────────────────────────────

export type Gateway =
  | "Stripe"
  | "Telr"
  | "Checkout"
  | "Tabby"
  | "Tamara"
  | "Shopify Payments"
  | "COD"
  | "Unclassified";

export type Store = "WA" | "UAE" | "KSA" | "WOO";

// The lifecycle of a single eligible bank credit line.
export type ReconState =
  | "AWAITING_PAYOUT" // bank credit exists, no payout file explains it yet
  | "PAYOUT_VARIANCE" // payout matched but net ≠ bank amount              (exception)
  | "ORDERS_UNRESOLVED" // net matches, but ≥1 referenced order not in Master_Orders (exception)
  | "SETTLED"; // bank ✅ + payout net ✅ + every order resolved ✅

export const RECON_LABEL: Record<ReconState, string> = {
  AWAITING_PAYOUT: "Awaiting payout file",
  PAYOUT_VARIANCE: "Variance",
  ORDERS_UNRESOLVED: "Orders unresolved",
  SETTLED: "Settled",
};

// ── Raw imported records ─────────────────────────────────────────────────────

// A credit line from the bank statement. THIS is truth. debit lines are stored
// separately as outflows and are never reconciled.
export type BankCredit = {
  id: string;
  date: string; // ISO
  narration: string;
  reference: string; // bank FT/DSZ ref
  amount: number; // AED credited (always > 0)
  // classification is INFERRED from narration; `confidence` is honest about it.
  provider: Gateway;
  confidence: "keyword" | "inferred" | "unknown";
};

export type BankDebit = {
  id: string;
  date: string;
  narration: string;
  reference: string;
  amount: number; // AED out (positive number, direction implied)
  kind: "salary" | "supplier" | "fee" | "tax" | "transfer" | "other";
};

// A payout file (one Stripe payout / one Telr .xls = one bank deposit).
// Uploaded via Workflow B. `net` is what the file says landed.
export type PayoutFile = {
  id: string; // Stripe automatic_payout_id / Telr "Payout ID 4841777"
  provider: Gateway;
  net: number; // AED net the file claims
  orderRefs: string[]; // Stripe: parsed from description · Telr: CartID prefixes
  uploadedAt: string;
  source: string; // filename
};

export type Order = {
  uid: string; // store + "_" + order_id  (globally unique)
  number: string; // order_number — MAY collide across stores, never join on alone
  store: Store;
  date: string;
  customer: string;
  currency: string; // what the customer paid in
  grossOriginal: number; // in `currency`
  grossAed: number; // AED equivalent — ONLY ever sum on this
  gateway: Gateway;
  telrCartId: string; // WooCommerce only; blank for Shopify
  telrTranref: string; // WooCommerce only; blank for Shopify
  financialStatus: string; // Shopify/Woo claim ("paid" / "cod_pending")
  // Passive: stamped ONLY when a bank-confirmed payout resolves this order.
  settledByPayoutId?: string;
};

// ── Sources (provenance shown in UI) ─────────────────────────────────────────

export const statementSource = {
  label: "Real sample",
  name: "OMNIASTORES LLC bank statement",
  period: "30 Jun 2026",
  account: "•••• 8001",
  iban: "AE45 •••• •••• •••• 98001",
  branch: "Sheikh Zayed Road",
  currency: "AED",
  importedAt: "14 Jul 2026, 09:42 GST",
};
export const orderSource = {
  label: "Real sample",
  name: "Omnia consolidated orders export",
  period: "12–13 Jul 2026",
  importedAt: "14 Jul 2026, 09:44 GST",
};

// ── Provider classification (keyword-driven, honest about confidence) ─────────
// Bank keywords per skill: Telr→INNOVATE, Stripe→NETWORK…STRIPE,
// Tabby→TABBY LLC FZ, Tamara→TAMARA FZE, Checkout→Checkout MENA.

export const descriptorRules: {
  keyword: string;
  provider: Gateway;
  confidence: "keyword" | "inferred";
}[] = [
  { keyword: "TAMARA", provider: "Tamara", confidence: "keyword" },
  { keyword: "CHECKOUT MENA", provider: "Checkout", confidence: "keyword" },
  { keyword: "CHECKOUT.COM", provider: "Checkout", confidence: "keyword" },
  { keyword: "INNOVATE TECHNOLOGIES", provider: "Telr", confidence: "keyword" },
  { keyword: "NETWORK", provider: "Stripe", confidence: "keyword" },
  { keyword: "TABBY", provider: "Tabby", confidence: "keyword" },
  { keyword: "SHOPIFY", provider: "Shopify Payments", confidence: "keyword" },
  // SABB is the settlement bank on some Tabby/BNPL rails but the name alone is
  // NOT a gateway. Mark as inferred so the founder sees it needs a rule, not a
  // fake green check.
  { keyword: "SABB", provider: "Tabby", confidence: "inferred" },
];

function classifyCredit(narration: string): {
  provider: Gateway;
  confidence: BankCredit["confidence"];
} {
  const text = narration.toUpperCase();
  for (const r of descriptorRules) {
    if (text.includes(r.keyword))
      return { provider: r.provider, confidence: r.confidence };
  }
  return { provider: "Unclassified", confidence: "unknown" };
}

// ── Real bank credits from the 30 Jun statement (doc 1) ───────────────────────
// Only inward/credit lines. Debits live in `bankDebits`.

const rawCredits: [id: string, narration: string, ref: string, amount: number][] =
  [
    [
      "C001",
      "Inward Telex Payment / TAMARA FZE / AE05••0004 / Inward RT Credit Posting",
      "FT26181NNDMQ\\HCP",
      11485.18,
    ],
    [
      "C002",
      "Inward Telex Payment / Checkout MENA FZ-LLC / Shatha Tower / REF 00000003JTVR",
      "FT26181W8VBX",
      7480.4,
    ],
    [
      "C003",
      "FTS CTD Cr Account Transfer / INNOVATE TECHNOLOGIES FZCO CLIENT M / REF PO300626 0134 20446",
      "FT261812T6G1",
      34168.21,
    ],
    [
      "C004",
      "Inward Telex Payment / SA SABB 003-777729-001 / BUSINESS RELATED PAYMENT / SAR AED 0.958561",
      "DSZ26181DJ0GGDHB",
      20084.14,
    ],
    [
      "C005",
      "Inward Telex Payment / SA SABB 003-777729-001 / BUSINESS RELATED PAYMENT / SAR AED 0.958561",
      "DSZ26181CBFHBHKJ",
      10234.67,
    ],
    [
      "C006",
      "Inward Telex Payment / SA SABB 003-777729-001 / BUSINESS RELATED PAYMENT / SAR AED 0.958561",
      "DSZ26181JCDJHGCF",
      7506.28,
    ],
    [
      "C007",
      "Inward Telex Payment / Sender Info AE170260…313206 / KWD AED 11.718141",
      "DSZ26181LLDDKCJG",
      1817.79,
    ],
    [
      "C008",
      "Inward Telex Payment / Sender Info AE170260…313206 / KWD AED 11.718141",
      "DSZ26181JFCDJHBK",
      4026.17,
    ],
  ];

export const bankCredits: BankCredit[] = rawCredits.map(
  ([id, narration, reference, amount]) => {
    const { provider, confidence } = classifyCredit(narration);
    return { id, date: "2026-06-30", narration, reference, amount, provider, confidence };
  },
);

// Outflows — read-only, never reconciled. (Sample from doc 1's debit lines.)
export const bankDebits: BankDebit[] = [
  {
    id: "D001",
    date: "2026-06-30",
    narration: "Outward Telex Payment / Muhammad Arslan / To AE12••0901",
    reference: "FT26181BGBRC\\HCP",
    amount: 6500,
    kind: "supplier",
  },
  {
    id: "D002",
    date: "2026-06-30",
    narration: "IBK Other Bank Trans Debit / Omnia Mohamed / TOF Transfer of Funds",
    reference: "FT26181LNBCP",
    amount: 35000,
    kind: "transfer",
  },
  {
    id: "D003",
    date: "2026-06-30",
    narration: "IBK Other Bank Trans Debit / Joyalukkas Exchange / Sal HOM Br",
    reference: "FT26181STGX3",
    amount: 66577.5,
    kind: "salary",
  },
  {
    id: "D004",
    date: "2026-06-30",
    narration: "Fees or Charges / 0012043598001",
    reference: "FT26181BGBRC\\HCP",
    amount: 0.48,
    kind: "fee",
  },
];

// ── Payout files (Workflow B). Empty until finance uploads them. ──────────────
// Seeded with the two we CAN explain from real data:
//   • Telr bank line C003 carries payout date PO300626 + merchant 20446 →
//     matches Telr payout file whose Net sums to the same AED.
//   • Checkout REF 00000003JTVR ↔ Checkout payout.
// Stripe/Tabby/Tamara payout files not yet uploaded → their credits stay
// AWAITING_PAYOUT, which is the honest state.

export const payoutFiles: PayoutFile[] = [
  {
    id: "TELR-PO300626",
    provider: "Telr",
    net: 34168.21, // sum of Net column = bank credit, cent-perfect
    orderRefs: ["601908", "5199"], // CartID prefixes (Woo resolvable, Shopify not)
    uploadedAt: "2026-07-14T09:50:00Z",
    source: "telr_payout_4841777.xls",
  },
  {
    id: "CKO-00000003JTVR",
    provider: "Checkout",
    net: 7480.4,
    orderRefs: ["3645", "3644", "3641"],
    uploadedAt: "2026-07-14T09:51:00Z",
    source: "checkout_settlement_JTVR.csv",
  },
];

// ── Orders (Master_Orders). financialStatus is a CLAIM, not proof. ────────────
// grossAed is the only sum-safe field.

const orderRows = [
  // uid, number, store, customer, currency, grossOriginal, grossAed, gateway, cartId, tranref, financialStatus
  ["WA_7088352657595", "5204", "WA", "Jawaher .", "AED", 1040, 1040, "Stripe", "", "", "paid"],
  ["UAE_6818557984926", "3347", "UAE", "مها جمعة", "AED", 2413.5, 2413.5, "COD", "", "", "cod_pending"],
  ["WA_7088277061819", "5203", "WA", "رقيه .", "AED", 891, 891, "Tamara", "", "", "paid"],
  ["KSA_6651813003318", "3646", "KSA", "مشاعل العتيبي", "SAR", 901.09, 864.09, "Tabby", "", "", "paid"],
  ["KSA_6651786166326", "3645", "KSA", "Sarah Abdulshafi", "SAR", 997.48, 956.53, "Checkout", "", "", "paid"],
  ["WA_7087926706363", "5202", "WA", "الجازي محمد شمس", "AED", 914, 914, "Stripe", "", "", "paid"],
  ["KSA_6651663941686", "3644", "KSA", "هند النعمان", "SAR", 1027.26, 984.99, "Checkout", "", "", "paid"],
  ["WA_7087243657403", "5201", "WA", "ABDU Nasar", "AED", 12178.5, 12178.5, "COD", "", "", "cod_pending"],
  ["KSA_6650253901878", "3643", "KSA", "سارة خلف", "SAR", 890.38, 853.75, "Tamara", "", "", "paid"],
  ["UAE_6817513111710", "3345", "UAE", "Salama Juma", "AED", 1668, 1668, "Shopify Payments", "", "", "paid"],
  ["WA_7085573537979", "5200", "WA", "ابتهال احمد سالم", "AED", 870, 870, "Stripe", "", "", "paid"],
  ["UAE_6817358545054", "3344", "UAE", "Salama Alharmoodi", "AED", 859.5, 859.5, "Tabby", "", "", "paid"],
  ["KSA_6650005094454", "3640", "KSA", "ام سعود البدر", "SAR", 783.28, 750.86, "Tamara", "", "", "paid"],
  ["WA_7084848644283", "5199", "WA", "حمده .", "AED", 2298, 2298, "Stripe", "", "", "paid"],
  ["WA_7084717441211", "5198", "WA", "Iqbal Alfi Alfi", "AED", 1703.5, 1703.5, "Checkout", "", "", "paid"],
  // WooCommerce order carrying real Telr refs → the only order-level Telr link
  ["WOO_601908", "601908", "WOO", "Najlaa Alamoudi", "AED", 5960.41, 5960.41, "Telr", "601908_6a4f", "030102641182", "paid"],
] as const;

export const orders: Order[] = orderRows.map((r) => ({
  uid: r[0],
  number: r[1],
  store: r[2] as Store,
  date: "2026-07-13",
  customer: r[3],
  currency: r[4],
  grossOriginal: r[5] as number,
  grossAed: r[6] as number,
  gateway: r[7] as Gateway,
  telrCartId: r[8],
  telrTranref: r[9],
  financialStatus: r[10],
}));

// ─────────────────────────────────────────────────────────────────────────────
// THE RECONCILER — bank → payout → orders. This is the whole system.
// ─────────────────────────────────────────────────────────────────────────────

const TOLERANCE_AED = 1.0; // cent/rounding tolerance for net vs bank

export type ReconLine = {
  id: string; // bank credit id
  date: string;
  narration: string;
  reference: string;
  provider: Gateway;
  confidence: BankCredit["confidence"];
  bankAmount: number; // TRUTH
  payout?: PayoutFile; // the file explaining it, if uploaded
  variance: number; // bankAmount − payout.net (0 when no payout)
  resolvedOrders: string[]; // order numbers found in Master_Orders
  unresolvedRefs: string[]; // referenced but NOT in Master_Orders
  state: ReconState;
};

const orderNumberSet = new Set(orders.map((o) => o.number));

// A payout is matched to a bank credit when provider agrees AND net ≈ bank.
function findPayoutFor(credit: BankCredit): PayoutFile | undefined {
  return payoutFiles.find(
    (p) =>
      p.provider === credit.provider &&
      Math.abs(p.net - credit.amount) <= Math.max(TOLERANCE_AED, credit.amount * 0.02),
  );
}

export const reconLines: ReconLine[] = bankCredits.map((c) => {
  const payout = findPayoutFor(c);

  if (!payout) {
    return {
      id: c.id,
      date: c.date,
      narration: c.narration,
      reference: c.reference,
      provider: c.provider,
      confidence: c.confidence,
      bankAmount: c.amount,
      variance: 0,
      resolvedOrders: [],
      unresolvedRefs: [],
      state: "AWAITING_PAYOUT",
    };
  }

  const variance = +(c.amount - payout.net).toFixed(2);
  const resolvedOrders = payout.orderRefs.filter((ref) => orderNumberSet.has(ref));
  const unresolvedRefs = payout.orderRefs.filter((ref) => !orderNumberSet.has(ref));

  let state: ReconState;
  if (Math.abs(variance) > TOLERANCE_AED) state = "PAYOUT_VARIANCE";
  else if (unresolvedRefs.length > 0) state = "ORDERS_UNRESOLVED";
  else state = "SETTLED";

  return {
    id: c.id,
    date: c.date,
    narration: c.narration,
    reference: c.reference,
    provider: c.provider,
    confidence: c.confidence,
    bankAmount: c.amount,
    payout,
    variance,
    resolvedOrders,
    unresolvedRefs,
    state,
  };
});

// Stamp orders: an order is Settled ONLY because a bank-confirmed payout reached it.
for (const line of reconLines) {
  if (line.state === "SETTLED" && line.payout) {
    for (const num of line.resolvedOrders) {
      const o = orders.find((x) => x.number === num);
      if (o) o.settledByPayoutId = line.payout.id;
    }
  }
}

export const orderIsSettled = (o: Order) => Boolean(o.settledByPayoutId);

// ── Founder-facing rollups (all derived from reconLines — bank-first) ─────────

export const settledLines = reconLines.filter((l) => l.state === "SETTLED");

export const exceptionBuckets = {
  awaitingPayout: reconLines.filter((l) => l.state === "AWAITING_PAYOUT"),
  variance: reconLines.filter((l) => l.state === "PAYOUT_VARIANCE"),
  ordersUnresolved: reconLines.filter((l) => l.state === "ORDERS_UNRESOLVED"),
};

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

export const stats = {
  bankConfirmed: sum(settledLines.map((l) => l.bankAmount)),
  awaitingPayout: sum(exceptionBuckets.awaitingPayout.map((l) => l.bankAmount)),
  creditsTotal: sum(bankCredits.map((c) => c.amount)),
  creditsCount: bankCredits.length,
  settledCount: settledLines.length,
  exceptionsCount:
    exceptionBuckets.awaitingPayout.length +
    exceptionBuckets.variance.length +
    exceptionBuckets.ordersUnresolved.length,
  ordersTotal: orders.length,
  ordersSettled: orders.filter(orderIsSettled).length,
  grossAed: sum(orders.map((o) => o.grossAed)), // sum-safe
  codExposure: sum(orders.filter((o) => o.gateway === "COD").map((o) => o.grossAed)),
};

export const stores: {
  code: Store;
  name: string;
  region: string;
  grossAed: number;
  orders: number;
  settled: number;
}[] = (["WA", "UAE", "KSA", "WOO"] as Store[]).map((code) => {
  const os = orders.filter((o) => o.store === code);
  return {
    code,
    name: { WA: "WhatsApp Shopify", UAE: "UAE Shopify", KSA: "KSA Shopify", WOO: "WooCommerce" }[code],
    region: { WA: "Gulf / WhatsApp", UAE: "United Arab Emirates", KSA: "Saudi Arabia", WOO: "Direct web" }[code],
    grossAed: sum(os.map((o) => o.grossAed)),
    orders: os.length,
    settled: os.filter(orderIsSettled).length,
  };
});

// Gateway mix by bank-confirmed settlement (not order claims).
export const gatewayMix = (
  ["Stripe", "Telr", "Checkout", "Tabby", "Tamara", "Shopify Payments"] as Gateway[]
).map((name, i) => ({
  name,
  settled: sum(settledLines.filter((l) => l.provider === name).map((l) => l.bankAmount)),
  awaiting: sum(
    reconLines
      .filter((l) => l.provider === name && l.state === "AWAITING_PAYOUT")
      .map((l) => l.bankAmount),
  ),
  color: `var(--chart-${(i % 5) + 1})`,
}));

// ── Formatters ────────────────────────────────────────────────────────────────
export const aed = (v: number) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(v);

export const exactAed = (v: number) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    minimumFractionDigits: 2,
  }).format(v);