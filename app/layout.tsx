import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KnowExper",
  description: "Upload PDF or PPTX course slides and academic papers, render each page, and generate detailed Chinese explanations.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
