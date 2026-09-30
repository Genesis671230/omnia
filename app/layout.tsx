import type React from "react"
import type { Metadata, Viewport } from "next"
import { Cormorant_Garamond, Manrope, Noto_Sans_Arabic } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "@/components/ui/sonner"
import { QueryProvider } from "@/components/providers/query-provider"
import "./globals.css"
import { BRAND, brandTitle } from "@/lib/config/brand";

const notoSans = Noto_Sans_Arabic({ subsets: ["arabic"], variable: "--font-noto-sans" })
const manrope = Manrope({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-manrope" })
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-cormorant" })

export const metadata: Metadata = {
  title: { default: brandTitle, template: `%s · ${brandTitle}` },
  description: BRAND.description,
  generator: "v0.app",
}
export const viewport: Viewport = { themeColor: "#f7f3eb", width: "device-width", initialScale: 1 }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`bg-background ${notoSans.variable} ${cormorant.variable} ${manrope.variable}`}><body className="font-sans antialiased"><QueryProvider>{children}<Toaster richColors/></QueryProvider><Analytics/></body></html>
}
