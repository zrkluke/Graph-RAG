import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "臺灣法律判決書 Graph RAG 搜尋與圖譜分析系統",
  description: "基於 Neo4j 知識圖譜與 OpenAI 語義向量檢索的智慧型法律判決搜尋系統。支援自然語言情境描述檢索，並結合圖譜關聯分析引用法條、罪名與被告關係結構。",
  openGraph: {
    title: "臺灣法律判決書 Graph RAG 搜尋與圖譜分析系統",
    description: "基於 Neo4j 知識圖譜與 OpenAI 語義向量檢索的智慧型法律判決搜尋系統。支援自然語言情境描述檢索，並結合圖譜關聯分析引用法條、罪名與被告關係結構。",
    type: "website",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
