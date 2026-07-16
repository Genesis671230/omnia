// app/login/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, landingFor } from "@/lib/auth-config";
import { verifySession } from "@/lib/session";
import { LoginForm } from "@/components/login/LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (session) redirect(from || landingFor(session.role));

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Left: brand panel — hidden on small screens */}
      <aside className="relative hidden overflow-hidden bg-foreground text-background lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="font-[family-name:var(--font-cormorant)] text-2xl tracking-tight">
          Omnia Finance OS
        </div>

        {/* Ledger-rule signature */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06]">
          <div
            className="h-full w-full"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to bottom, currentColor 0, currentColor 1px, transparent 1px, transparent 34px)",
            }}
          />
        </div>

        <div className="relative max-w-md">
          <p className="font-[family-name:var(--font-cormorant)] text-4xl leading-tight">
            Every figure traces back to the bank.
          </p>
          <p className="mt-4 text-sm/relaxed text-background/70">
            Reconciled financial operations for Omnia Stores across UAE, KSA, WhatsApp,
            and WooCommerce.
          </p>
        </div>

        <div className="relative flex items-center gap-6 text-xs text-background/50">
          <span>UAE</span><span>KSA</span><span>WhatsApp</span><span>WooCommerce</span>
        </div>
      </aside>

      {/* Right: form */}
      <section className="flex items-center justify-center px-6 py-12">
        <LoginForm redirectTo={from} />
      </section>
    </main>
  );
}