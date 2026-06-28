import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nearhum",
  description: "The hum of voices near you",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: "#040806" }}>{children}</body>
    </html>
  );
}
