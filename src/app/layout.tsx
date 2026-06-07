import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PRD Architect - AI-Powered Product Discovery",
  description: "Refine raw software concepts into production-ready product discovery guidelines and spec sheets.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-50 font-sans selection:bg-zinc-800 selection:text-white">
        {children}
      </body>
    </html>
  );
}
