"use client";

import { useState } from "react";
import type { PersistedState } from "@/lib/types";
import { buildShareUrl } from "@/lib/share-link";
import { Button } from "@/components/ui/button";

// "Share this view" action — design-discussion.md §9.3. Encodes the current
// Profile/Assumptions + sort order into a URL and copies it to the
// clipboard, so a visitor can send someone else their exact ranked view
// without either party having an account or any server round-trip.
export function ShareButton({ state }: { state: PersistedState }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const base = `${window.location.origin}${window.location.pathname}`;
    const url = buildShareUrl(base, state);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can be unavailable (older browsers, insecure
      // context) — fall back to a prompt so the link is still obtainable.
      window.prompt("Copy this link:", url);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleShare}
      className="font-mono text-[0.68rem]"
    >
      {copied ? "link copied" : "share this view"}
    </Button>
  );
}
