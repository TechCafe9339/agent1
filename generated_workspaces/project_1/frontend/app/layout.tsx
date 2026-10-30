import Link from "next/link";

import "./globals.css";

import AuthNav from "../components/AuthNav";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <nav className="app-nav">
            <Link href="/dashboard">
              Dashboard
            </Link>

            <Link href="/categories">
              Categories
            </Link>

            <Link href="/income">
              Income
            </Link>

            <Link href="/expenses">
              Expenses
            </Link>

            <Link href="/budget">
              Budget
            </Link>

            <Link href="/analytics">
              Analytics
            </Link>

            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                gap: "12px",
                alignItems: "center",
              }}
            >
              <AuthNav />
            </div>
          </nav>
        </header>

        <main className="app-main">
          {children}
        </main>
      </body>
    </html>
  );
}