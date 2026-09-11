import { Section, SectionHeading } from "./ui/section";
import { Chip } from "./ui/chip";
import { INTEGRATIONS } from "@/lib/ramza/copy";

/* Text chips, three groups. No logos. "On request" chips deep-link to the
   audit form with the accounting tool pre-selected. */
export function Integrations() {
  return (
    <Section id="integrations">
      <SectionHeading>Integrations</SectionHeading>

      <div className="mt-10 space-y-8">
        <Group label="Stores">
          {INTEGRATIONS.stores.map((s) => (
            <Chip key={s.name}>{s.name}</Chip>
          ))}
        </Group>

        <Group label="Payments">
          {INTEGRATIONS.payments.map((s) => (
            <Chip key={s.name}>{s.name}</Chip>
          ))}
        </Group>

        <Group label="Books">
          {INTEGRATIONS.books.map((b) => (
            <Chip
              key={b.name}
              status={b.status}
              href={b.status === "on-request" ? `?tool=${b.tool}#audit` : undefined}
            >
              {b.name}
            </Chip>
          ))}
        </Group>
      </div>
    </Section>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <span className="w-24 shrink-0 text-sm font-medium" style={{ color: "var(--ink-60)" }}>
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
