import { Section, SectionHeading } from "./ui/section";
import { Reveal } from "./reveal";
import { ACCOUNTANT_COPY, ACCOUNTANT_ROW } from "@/lib/ramza/copy";

/* Static synthetic example — one row. No real data. */
export function AccountantView() {
  const cols = [
    ["Invoice total", ACCOUNTANT_ROW.invoiceTotal],
    ["Received", ACCOUNTANT_ROW.received],
    ["Gateway fee", ACCOUNTANT_ROW.gatewayFee],
    ["VAT on fee", ACCOUNTANT_ROW.vatOnFee],
    ["Status", ACCOUNTANT_ROW.status],
  ];
  return (
    <Section>
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <SectionHeading>What your accountant sees</SectionHeading>
          <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
            {ACCOUNTANT_COPY}
          </p>
        </div>
        <Reveal className="lg:-mt-8">
         <div className="r-glass overflow-hidden rounded-2xl">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {cols.map(([h]) => (
                  <th
                    key={h}
                    className="border-b r-hairline px-3 py-2.5 text-xs font-medium"
                    style={{ color: "var(--ink-60)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {cols.map(([h, v]) => (
                  <td
                    key={h}
                    className={`px-3 py-3 ${h === "Status" ? "" : "tnum"}`}
                    style={{ color: "var(--ink)" }}
                  >
                    {h === "Status" ? (
                      <span className="r-pill r-pill-matched">{v}</span>
                    ) : (
                      v
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
         </div>
        </Reveal>
      </div>
    </Section>
  );
}
