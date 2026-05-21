import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Yomi — Your AI buddy",
  description: "Cross-platform AI buddy. Sees your screen, hears your voice, acts so you touch your laptop less.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
