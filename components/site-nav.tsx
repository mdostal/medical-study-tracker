import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
// Static import, not a string src="/icon-mark.png" -- next/image doesn't
// reliably prepend next.config.ts's basePath for a plain string path (404s
// under /study-tracker in practice), but a statically-imported public/
// asset gets its final basePath-correct URL resolved at build time.
import iconMark from "../public/icon-mark.png";

/**
 * Sitewide top nav. Keeps the homepage itself focused purely on the ranked
 * table -- everything explanatory (methodology, data sources, disclaimer)
 * lives on its own dedicated page, reachable from here, not crammed into
 * the main view or left as footer-only discovery.
 */
export function SiteNav() {
  return (
    <nav className="mx-auto flex max-w-[1100px] items-center justify-between px-4 py-4 text-sm sm:px-6">
      <Link
        href="/"
        className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wide text-foreground"
      >
        <Image src={iconMark} alt="" width={20} height={20} className="rounded-[22%]" />
        Medical Study Tracker
      </Link>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[0.72rem] uppercase tracking-wide text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Tracker
        </Link>
        <Link href="/chase" className="hover:text-foreground">
          Chase
        </Link>
        <Link href="/about" className="hover:text-foreground">
          About
        </Link>
        <Link href="/networks" className="hover:text-foreground">
          Networks
        </Link>
        <Link href="/resources" className="hover:text-foreground">
          Resources
        </Link>
        <Link href="/disclaimer" className="hover:text-foreground">
          Disclaimer
        </Link>
        <ThemeToggle />
      </div>
    </nav>
  );
}
