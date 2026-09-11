import { FinanceWorkspace } from "@/components/finance/finance-workspace"

// Live authenticated dashboard — never statically prerendered. Also the
// documented fix for FinanceWorkspace's useSearchParams() needing a Suspense
// boundary under static rendering.
export const dynamic = "force-dynamic"

export default function Page() { return <FinanceWorkspace view="documents" /> }
