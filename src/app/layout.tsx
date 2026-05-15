import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope, Source_Code_Pro } from "next/font/google";
import { ToasterProvider } from "@/components/toaster-provider";
import "./globals.css";

const displayFont = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const bodyFont = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

const monoFont = Source_Code_Pro({
  variable: "--font-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RJ Disposable Camera",
  description: "Standalone disposable camera app for event guests.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} antialiased`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        {children}
        <ToasterProvider />
      </body>
    </html>
  );
}
