import type { Metadata } from "next";
import { Geist, JetBrains_Mono, Roboto } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/layout/site-header/site-header";
import { SiteFooter } from "@/components/layout/site-footer/site-footer";
import { ThemeProvider } from "@/components/layout/theme-provider/theme-provider";

const robotoHeading = Roboto({
  subsets: ["latin"],
  variable: "--font-heading",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const SITE_URL = "https://demo.innovationisttech.com";
const SITE_DESCRIPTION =
  "Live demos from Innovationist Tech. Feed a chatbot your own documents and watch what it retrieves, or flip a config flag and see every open browser follow along.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Demos | InnovationistTech",
    template: "%s | InnovationistTech Demos",
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "InnovationistTech Demos",
    title: "Demos | InnovationistTech",
    description: SITE_DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Demos | InnovationistTech",
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "h-full",
        "antialiased",
        geistSans.variable,
        "font-mono",
        jetbrainsMono.variable,
        robotoHeading.variable,
      )}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
