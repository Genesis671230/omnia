import { FinanceWorkspace } from "@/components/finance/finance-workspace"

// Live authenticated dashboard — never statically prerendered (also satisfies
// FinanceWorkspace's useSearchParams() Suspense requirement under static render).
export const dynamic = "force-dynamic"

export default function Page() {
  return <FinanceWorkspace view="dashboard" />
}
