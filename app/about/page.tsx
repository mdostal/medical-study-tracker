import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — Medical Study Tracker",
  description:
    "How the ranking actually works: net cash kept, cash velocity, downtime, and the gates that keep it honest.",
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-[1100px] space-y-8 px-4 py-10 sm:px-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          What this tool actually does
        </h1>
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          Most &ldquo;find a study&rdquo; sites sort by the headline &ldquo;up to
          $X&rdquo; figure and stop there. That number lies by omission — a
          $30,000 study that pays out over six months can be worse bridge cash
          than a $15,000 study that settles in a month, and neither number
          means much once you subtract travel and dependent-care costs. This
          tool does that math for every listing, ranks by what you actually
          keep and how fast you get it, and never hides the eligibility gate
          behind a screening call.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          The three headline numbers
        </h2>
        <dl className="max-w-[70ch] space-y-3 text-sm leading-relaxed text-muted-foreground">
          <div>
            <dt className="font-medium text-foreground">Net cash kept</dt>
            <dd>
              Gross pay minus travel cost minus dependent-care cost (if you&apos;ve
              told it you have dependents needing coverage — see below). The
              number that actually lands in your account, not the number on
              the flyer.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Cash velocity</dt>
            <dd>
              Net cash divided by days until you&apos;re actually paid, normalized
              to a 30-day rate. This is the number that tells a
              $30k-in-6-months study from a $15k-in-1-month study — the
              smaller, faster study usually wins if bridge cash is the goal,
              and payout timing is rarely published anywhere except a phone
              call, which is why it&apos;s flagged &ldquo;unconfirmed&rdquo; until
              someone reports it back.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Downtime rate</dt>
            <dd>
              Net cash divided by total days of life committed — confinement
              nights plus a discounted follow-up-visit tail. Two studies can
              pay the same but cost wildly different amounts of your actual
              time.
            </dd>
          </div>
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          Two gates, kept separate on purpose
        </h2>
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Eligibility</strong> is a hard
          filter — BMI range, age, sex, smoker status, special populations
          (e.g. a study requiring BMI 27+). If you don&apos;t qualify, the study
          shows up in a separate &ldquo;doesn&apos;t apply&rdquo; list with the
          reason, never mixed into your ranked results.{" "}
          <strong className="text-foreground">Feasibility</strong> is
          different: can you actually arrange the stay, logistically? That&apos;s
          driven by your own home base (any US city, real drive-vs-fly
          distance, not a fixed list) and whether you&apos;ve configured any
          dependent-care coverage of your own. Neither gate is guessed on your
          behalf.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          Dependent care, on your terms
        </h2>
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          A single visitor with no dependents pays nothing extra in this
          model — the cost is exactly $0, unconditionally, unless you turn on
          &ldquo;I have dependents needing care while I&apos;m away&rdquo; yourself.
          If you do, you set your own estimated backup-care rate and which
          cities you personally have free coverage in — nothing is assumed or
          defaulted to &ldquo;free&rdquo; on your behalf.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          Data: automated, refreshed daily, community-checked
        </h2>
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          Study listings are pulled directly from each network&apos;s own site on
          a daily schedule — see{" "}
          <Link
            href="/resources"
            className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
          >
            Resources
          </Link>{" "}
          for exactly which networks and how. Anyone can submit a correction
          (no account needed) if something&apos;s wrong or out of date — those
          corrections build confidence automatically as independent people
          agree, and show as openly disputed rather than silently overwritten
          when they don&apos;t. Nothing here is fabricated: an unpublished field
          (BMI range, payout timing) stays flagged as unconfirmed rather than
          guessed.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          No accounts, nothing tracked server-side
        </h2>
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          Your Profile (BMI, home base, weights, dependent-care settings) and
          status pipeline live entirely in your own browser&apos;s local
          storage — there&apos;s no sign-in, no server-side record of who you are
          or what you looked at. Want to share a specific ranking with
          someone? A &ldquo;share this view&rdquo; link encodes your inputs
          directly in the URL.
        </p>
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-5">
        <h2 className="text-base font-semibold tracking-tight">
          Support this project
        </h2>
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          Free and open source, always. A few ways to help — or just say hi:
        </p>
        <ul className="max-w-[70ch] list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>
            <strong className="text-foreground">Use it, star it, file an issue.</strong> Honestly
            the best support an open-source project can get.
          </li>
          <li>
            <strong className="text-foreground">Hire me.</strong> I do fractional-CTO and
            consulting work — fixing and scaling tech stacks. &rarr;{" "}
            <a
              href="https://mdostal.com/contact"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
            >
              mdostal.com/contact
            </a>
          </li>
          <li>
            <a
              href="https://www.buymeacoffee.com/mdostal"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
            >
              Buy me a coffee
            </a>{" "}
            if it saved you time.
          </li>
          <li>
            <strong className="text-foreground">More tools like this</strong> &rarr;{" "}
            <a
              href="https://tools.mdostal.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
            >
              tools.mdostal.com
            </a>
          </li>
          <li>
            <strong className="text-foreground">Life outside the terminal</strong> &rarr;{" "}
            <a
              href="https://life.mdostal.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
            >
              life.mdostal.com
            </a>
          </li>
          <li>
            <strong className="text-foreground">
              What we&apos;re building at Firefly Events
            </strong>{" "}
            — event discovery, 8,000+ events/day from 7+ sources &rarr;{" "}
            <a
              href="https://ff.events"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
            >
              ff.events
            </a>
          </li>
        </ul>
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          Always up for a conversation if any of it&apos;s useful to you.
        </p>
      </section>

      <p className="pt-4 text-xs text-muted-foreground">
        See also:{" "}
        <Link
          href="/resources"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          Resources
        </Link>{" "}
        ·{" "}
        <Link
          href="/disclaimer"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          Disclaimer
        </Link>{" "}
        ·{" "}
        <a
          href="https://github.com/mdostal/medical-study-tracker"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          Source (MIT licensed)
        </a>
      </p>
    </main>
  );
}
