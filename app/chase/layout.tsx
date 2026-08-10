import type { Metadata } from "next";

// Server-component layout purely so this route gets a real <title>/description
// (Metadata export requires a server component) while app/chase/page.tsx
// itself is a client component -- same split app/page.tsx's sibling route
// files use, e.g. this repo's root app/layout.tsx (server, metadata) wrapping
// app/page.tsx (client, "use client").
export const metadata: Metadata = {
  title: "Chase pipeline — Medical Study Tracker",
  description:
    "Where each application actually is right now and what to do next -- status, tap-to-call, business hours, and the call-log detail behind it.",
};

export default function ChaseLayout({ children }: { children: React.ReactNode }) {
  return children;
}
