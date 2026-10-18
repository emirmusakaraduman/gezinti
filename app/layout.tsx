import type { Metadata } from "next";
import { Caveat, Instrument_Sans, Poppins } from "next/font/google";
import "./globals.css";

// Başlıklar: kalın, eğik, geniş bir grotesk (etiket kutularında). Gövde: sakin bir sans.
// El yazısı: kenar notları için. latin-ext, Türkçe harfler (ğ, ı, ş, İ) için gerekli.
const display = Poppins({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
  weight: ["700", "800"],
  style: ["italic"],
});

const body = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin", "latin-ext"],
});

const hand = Caveat({
  variable: "--font-hand",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "Gezinti",
  description: "Bütçene uygun şehir gezisi: mekanlar, yemekler ve toplu taşıma rotası saat saat planlanır.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" className={`${display.variable} ${body.variable} ${hand.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
