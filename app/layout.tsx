import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import "./globals.css";

// Başlıklar: karakterli, değişken eksenli bir grotesk. Gövde: sakin, okunaklı bir sans.
// latin-ext, Türkçe harfler (ğ, ı, ş, İ) için gerekli.
const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
});

const body = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "Gezinti",
  description: "Bütçene uygun şehir gezisi: mekanlar, yemekler ve toplu taşıma rotası saat saat planlanır.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
