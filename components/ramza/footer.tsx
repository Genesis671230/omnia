import { Wordmark } from "./wordmark";

export function Footer({
  whatsappHref,
  email,
  legalLine,
}: {
  whatsappHref: string;
  email: string;
  legalLine: string;
}) {
  return (
    <footer className="border-t r-hairline">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 text-sm sm:flex-row sm:items-center sm:justify-between">
        <Wordmark />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2" style={{ color: "var(--ink-60)" }}>
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="hover:underline">
            WhatsApp
          </a>
          <a href={`mailto:${email}`} className="hover:underline">
            {email}
          </a>
          <a href="/privacy" className="hover:underline">
            Privacy
          </a>
          <span>{legalLine}</span>
        </div>
      </div>
    </footer>
  );
}
