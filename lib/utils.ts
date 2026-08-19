import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// A study/network URL can originate from a daily scrape of a third-party site
// (scripts/pull-studies.mjs, scripts/discover-networks.mjs), a no-login community correction, or
// a visitor's own "add study by URL" submission -- none of that is trusted input. Upstream
// `new URL(href, base)` resolution only sanitizes RELATIVE hrefs; an absolute `javascript:`/
// `data:` href round-trips straight through unchanged and, rendered as a real <a href>, executes
// on click on this site's own origin (where visitor Profile/Applications localStorage data
// lives). Every component that renders one of these URLs as a clickable link calls this first.
export function isSafeHttpUrl(u: string | undefined | null): u is string {
  if (!u) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
