import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIS Dark Tracker",
  description:
    "Live marine traffic and analysis of vessels that stop transmitting AIS.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav className="topnav">
          <Link href="/" className="brand">
            AIS Dark Tracker
          </Link>
          <div className="links">
            <Link href="/">Live map</Link>
            <Link href="/dark/">Dark events</Link>
            <Link href="/why/">Why ships go dark</Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
