// scripts/probe-zoho-invoice-list.ts
import {  listZohoInvoices } from "@/lib/integrations/zoho";

async function main() {
const r = await listZohoInvoices(
  { status: "overdue", dateStart: "2026-08-01", dateEnd: "2026-08-17", perPage: 15 },
);

console.log(`Got ${r.invoices.length} invoices, hasMorePage=${r.hasMorePage}`);
console.log(r.invoices.map(i => ({
  invoice_number: i.invoice_number,
  date: i.date,
  status: i.status,
  balance: i.balance,
    })),
  );
  console.log(r.invoices.map(i => ({
      customer_name: i.customer_name,
      invoice_number: i.invoice_number,
      date: i.date,
      due_date: i.due_date,
      status: i.status,
      total: i.total,
      balance: i.balance,
      currency_code: i.currency_code,
    })),
);
}
main();