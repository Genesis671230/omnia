"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bell, ChartNoAxesCombined, ChevronDown, CircleHelp, FileChartColumn, Landmark, LayoutDashboard, LogOut, Menu, PackageSearch, RefreshCcw, RotateCcw, Search, Settings, WalletCards } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sales", label: "Sales", icon: ChartNoAxesCombined },
  { href: "/orders", label: "Orders", icon: PackageSearch },
  { href: "/reconciliation", label: "Reconciliation", icon: RefreshCcw },
  { href: "/payouts", label: "Payouts", icon: WalletCards },
  { href: "/returns", label: "Returns", icon: RotateCcw },
  { href: "/reports", label: "Reports", icon: FileChartColumn },
  { href: "/settings", label: "Settings", icon: Settings },
]

function Brand() { return <Link href="/" className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-full border border-sidebar-primary/50 font-serif text-lg text-sidebar-primary">O</span><span><span className="block font-serif text-xl tracking-[0.18em]">OMNIA</span><span className="block text-[10px] uppercase tracking-[0.28em] text-sidebar-foreground/50">Finance OS</span></span></Link> }
function Nav() {
  const path = usePathname()
  return <nav className="flex flex-col gap-1" aria-label="Finance navigation">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", path === href && "bg-sidebar-accent text-sidebar-primary")}><Icon className="size-4" />{label}</Link>)}</nav>
}
function Sidebar() { return <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-sidebar p-5 text-sidebar-foreground lg:flex"><Brand/><div className="mt-8 rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-3"><p className="text-[10px] uppercase tracking-widest text-sidebar-foreground/45">Portfolio</p><button className="mt-2 flex w-full items-center justify-between text-left text-sm"><span>All 4 stores</span><ChevronDown className="size-4"/></button></div><div className="mt-6 flex-1"><Nav/></div><div className="flex flex-col gap-1 border-t border-sidebar-border pt-4"><Link href="/help" className="flex items-center gap-3 px-3 py-2 text-sm text-sidebar-foreground/60"><CircleHelp className="size-4"/>Help centre</Link><Link href="/logout" className="flex items-center gap-3 px-3 py-2 text-sm text-sidebar-foreground/60"><LogOut className="size-4"/>Log out</Link></div></aside> }

export function FinanceShell({ children, title, description, action }: { children: React.ReactNode; title: string; description: string; action?: React.ReactNode }) {
  return <div className="min-h-screen bg-background"><Sidebar/><main className="min-w-0 lg:ml-64"><header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur md:px-7"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3 lg:hidden"><Sheet><SheetTrigger asChild><Button variant="outline" size="icon" aria-label="Open navigation"><Menu/></Button></SheetTrigger><SheetContent side="left" className="w-72 bg-sidebar p-5 text-sidebar-foreground"><SheetTitle className="sr-only">Navigation</SheetTitle><Brand/><div className="mt-8"><Nav/></div></SheetContent></Sheet></div><div className="relative hidden max-w-md flex-1 md:block"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input className="bg-card pl-9" placeholder="Search orders, payouts, bank references…" aria-label="Global search"/></div><div className="flex items-center gap-2"><Button variant="outline" size="sm" className="hidden sm:flex"><Landmark/>Bank is source of truth</Button><Button variant="ghost" size="icon" aria-label="Notifications"><Bell/></Button><Avatar className="size-9"><AvatarImage src="/profile.jpg" alt="Omnia founder"/><AvatarFallback>OA</AvatarFallback></Avatar></div></div></header><div className="p-4 md:p-7"><div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-primary">Omnia financial operations</p><h1 className="font-serif text-3xl font-medium tracking-tight md:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p></div>{action}</div>{children}</div></main></div>
}
