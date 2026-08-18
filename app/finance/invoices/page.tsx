import { InvoicesWorkbench } from "@/components/finance/invoices-workbench";

export const metadata = { title: "Invoices · Omnia" };

export default function InvoicesPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-4">
        <h1 className="text-[22px] font-semibold text-[#1F1B16]">Invoices</h1>
        <p className="mt-0.5 text-[13px] text-[#8A8175]">
          Zoho invoices, filterable by gateway and date. Bulk-select and record payments — or spot exchanges before they slip.
        </p>
      </div>
      <InvoicesWorkbench />
    </div>
  );
}