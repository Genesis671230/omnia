// const summary = await getSummaryForSku(sku); // reuse inventory-compare
// const targets = summary.stores.filter((s) => s.listed && s.quantity !== null && s.quantity !== summary.zohoStock);
// if (targets.length === 0) {
//   return NextResponse.json({ ok: true, skipped: "no drifted channels" });
// }