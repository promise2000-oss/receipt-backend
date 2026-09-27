import type { ReactNode } from "react";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

export const metadata = {
  title: {
    default: "Eleosstyles Receipt System",
    template: "%s · Eleosstyles Receipt System",
  },
  description:
    "Create, brand, send and track beautifully designed sales receipts for your business.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Loaded at runtime rather than at build time so a build never
            depends on reaching Google Fonts. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Manrope:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
