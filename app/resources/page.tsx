import Link from "next/link";
import type { Metadata } from "next";
import networksData from "@/data/networks.json";

export const metadata: Metadata = {
  title: "Resources — Medical Study Tracker",
  description:
    "Where the data comes from, the networks we pull from, and other places worth checking.",
};

interface NetworkSite {
  city?: string;
  state?: string;
  country?: string;
}

interface NetworkEntry {
  name: string;
  portal?: string;
  sites?: NetworkSite[];
}

const NETWORKS = (networksData.networks ?? []) as NetworkEntry[];

export default function ResourcesPage() {
  return (
    <main className="mx-auto max-w-[1100px] space-y-8 px-4 py-10 sm:px-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Resources</h1>
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          Where this tool&apos;s data actually comes from, the networks it pulls
          from, and other places worth checking directly — this tool doesn&apos;t
          try to be the only source.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          How the data pipeline works
        </h2>
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          A scheduled job re-pulls each network&apos;s own site daily (see{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            .github/workflows/daily-study-refresh.yml
          </code>{" "}
          in the source repo), reading whatever fields that network actually
          publishes — pay, nights, BMI range, special populations. Nothing is
          invented for a field a network doesn&apos;t publish; it&apos;s flagged as
          unconfirmed instead. A study that disappears from a network&apos;s own
          listing (filled, closed, expired) isn&apos;t just deleted — it&apos;s marked
          closed and drops out of the ranked table, but stays around for a few
          months in case you already have it in your{" "}
          <Link
            href="/chase"
            className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
          >
            chase pipeline
          </Link>
          . On top of that, anyone can submit a correction
          with no account required — those build confidence automatically as
          independent people agree on the same value, and show as openly
          disputed (not silently overwritten) when they conflict. See{" "}
          <Link
            href="/about"
            className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
          >
            About
          </Link>{" "}
          for the full ranking methodology.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">
          The networks we pull from
        </h2>
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          Confirmed paid Phase-1 / healthy-volunteer networks currently
          tracked. Some have fully automated live scraping; others are
          confirmed-enrolling but phone-only or register-gated, in which case
          this tool shows an honest &ldquo;call to apply&rdquo; instead of a
          disguised link. Full detail (portals, phones, per-site notes) is on
          the{" "}
          <Link
            href="/networks"
            className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
          >
            network directory
          </Link>
          .
        </p>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {NETWORKS.map((n) => {
            const sites = (n.sites ?? [])
              .map((s) => [s.city, s.state].filter(Boolean).join(" "))
              .filter(Boolean)
              .join(", ");
            return (
              <li
                key={n.name}
                className="rounded-lg border bg-card px-3 py-2 text-muted-foreground"
              >
                <span className="font-medium text-foreground">{n.name}</span>
                {sites && <span className="block text-xs">{sites}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Other places to check
        </h2>
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          Complementary resources — not competitors, and nothing from these is
          pulled automatically into this tool&apos;s ranking. Worth checking
          directly, especially for networks or details this tool doesn&apos;t
          have yet.
        </p>
        <ul className="space-y-3 text-sm">
          <li>
            <a
              href="https://jalr.org"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
            >
              Just Another Lab Rat (jalr.org)
            </a>
            <span className="block text-muted-foreground">
              A long-running, community-run directory of Phase-1 clinics
              nationally, plus separate directories for university-run and
              patient (Phase II-IV) clinics. This tool&apos;s{" "}
              <Link
                href="/networks"
                className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
              >
                &ldquo;discovered, not yet verified&rdquo;
              </Link>{" "}
              network entries are found by diffing JALR&apos;s directory against
              our own confirmed list — real facts pulled from JALR&apos;s own
              clinic pages (alternate phone numbers, payout-timing notes) are
              also surfaced this way, always attributed, never merged into
              scraped data as if verified.
            </span>
          </li>
          <li>
            <a
              href="http://jalr.proboards.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
            >
              JALR community forum
            </a>
            <span className="block text-muted-foreground">
              Where actual participants compare notes on specific studies and
              sites — the kind of first-hand detail no automated pull will
              ever fully capture.
            </span>
          </li>
          <li>
            <a
              href="https://jalr.org/frequently_asked_questions.html"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
            >
              JALR FAQ
            </a>
            <span className="block text-muted-foreground">
              General first-timer questions about how paid clinical trials
              work, unrelated to any specific listing here.
            </span>
          </li>
          <li>
            <a
              href="https://studyscavenger.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
            >
              Study Scavenger
            </a>
            <span className="block text-muted-foreground">
              A patient/volunteer-facing trial-matching search by zip code,
              compensation, or health condition, run by the same team that
              maintains JALR&apos;s clinic listings.
            </span>
          </li>
        </ul>
      </section>

      <p className="pt-2 text-xs text-muted-foreground">
        See also:{" "}
        <Link
          href="/about"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          About
        </Link>{" "}
        ·{" "}
        <Link
          href="/disclaimer"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          Disclaimer
        </Link>
      </p>
    </main>
  );
}
