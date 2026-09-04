import type React from "react"
import type { Metadata, Viewport } from "next"
import { Cormorant_Garamond, Noto_Sans_Arabic } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "@/components/ui/sonner"
import { QueryProvider } from "@/components/providers/query-provider"
import "./globals.css"

const notoSans = Noto_Sans_Arabic({ subsets: ["arabic"], variable: "--font-noto-sans" })
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-cormorant" })

export const metadata: Metadata = {
  title: { default: "Omnia Finance OS", template: "%s · Omnia Finance OS" },
  description: "Bank-grounded financial operations for Omnia Stores across UAE, KSA, WhatsApp, and WooCommerce.",
  generator: "v0.app",
}
export const viewport: Viewport = { themeColor: "#f7f3eb", width: "device-width", initialScale: 1 }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`bg-background ${notoSans.variable} ${cormorant.variable}`}><body className="font-sans antialiased"><QueryProvider>{children}<Toaster richColors/></QueryProvider><Analytics/></body></html>
}
