import Link from "next/link";

/**
 * Sitewide footer: the disclaimer (not medical/financial advice) and links out to
 * community resources this tool doesn't try to replace or compete with — JALR's
 * directory, forum, and FAQ, plus Study Scavenger. See app/disclaimer/page.tsx for
 * the full breakdown; this footer is the short, always-visible version plus links.
 */
export function SiteFooter() {
  return (
    <footer className="mx-auto mt-12 max-w-[1100px] space-y-4 border-t px-4 py-8 text-sm text-muted-foreground sm:px-6">
      <p className="max-w-[70ch]">
        <strong className="text-foreground">
          This is not medical advice, and it is not financial advice.
        </strong>{" "}
        It ranks and organizes publicly available information about paid clinical
        trials so it&apos;s easier to compare — it doesn&apos;t evaluate whether a
        study is medically right for you, and it doesn&apos;t guarantee any figure
        shown will match what you&apos;re actually paid. Full breakdown:{" "}
        <Link
          href="/disclaimer"
          className="font-medium underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          read the disclaimer
        </Link>
        .
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-[0.72rem] uppercase tracking-wide">
        <a
          href="https://jalr.org"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          JALR directory
        </a>
        <a
          href="http://jalr.proboards.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          JALR community forum
        </a>
        <a
          href="https://jalr.org/frequently_asked_questions.html"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          JALR FAQ
        </a>
        <a
          href="https://studyscavenger.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          Study Scavenger
        </a>
        <Link
          href="/networks"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          Network directory
        </Link>
      </div>
    </footer>
  );
}
