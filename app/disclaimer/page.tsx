import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Disclaimer — Medical Study Tracker",
  description:
    "Not medical advice, not financial advice — what this tool actually does and doesn't do.",
};

export default function DisclaimerPage() {
  return (
    <main className="mx-auto max-w-[70ch] space-y-8 px-4 py-10 sm:px-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Disclaimer</h1>
        <p className="text-sm text-muted-foreground">
          The short version:{" "}
          <strong className="text-foreground">
            this is not medical advice, and it is not financial advice.
          </strong>{" "}
          It&apos;s an information tool — it helps you find and compare paid
          clinical-trial studies faster than reading each network&apos;s site one at a
          time. That&apos;s the whole job.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          What this tool actually does
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          It pulls publicly available study listings from clinical-research
          network sites, organizes the eligibility, pay, timing, and logistics
          fields those sites already publish, and ranks the results by net cash
          kept, cash velocity, and downtime — the math is transparent (see{" "}
          <Link
            href="https://github.com/mdostal/medical-study-tracker/blob/main/docs/SCORING.md"
            className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
          >
            docs/SCORING.md
          </Link>{" "}
          in the source repo). It does not evaluate a study&apos;s medical
          protocol, does not assess your personal health risk, and does not
          decide anything on your behalf. You still call the site, talk to a
          real recruiter, and make your own call.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          Not medical advice
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Nothing on this site is a recommendation that you participate in any
          study, that a study is safe, or that you are medically eligible —
          eligibility criteria shown here (BMI ranges, age, special
          populations, etc.) are pulled from each network&apos;s own published
          listing or detail page, and are flagged as unconfirmed whenever a
          source doesn&apos;t publish them clearly. Confirm every medical detail
          directly with the study&apos;s own screening staff before you agree to
          anything.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          Not financial advice
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Pay figures are &ldquo;up to&rdquo; amounts as published by each
          network — actual payment depends on completing the full study
          protocol, and payout timing (when you actually receive the money) is
          frequently not published online at all; this tool flags those cases
          rather than guessing. Net-cash and cash-velocity numbers are
          estimates built from your own entered assumptions (travel cost,
          dependent-care cost, home base), not verified financial figures.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          The harm-liability gap
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Clinical trial sponsors are generally not required to cover
          long-term injury the way workers&apos; compensation or health
          insurance might — compensation for a study-related injury, if any,
          is typically limited to the trial&apos;s own stated injury policy.
          Ask about this specifically before enrolling; it&apos;s rarely
          advertised up front.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          Data accuracy
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Study data is pulled automatically on a daily schedule and
          supplemented by community-submitted corrections (shown with a
          confidence level — confirmed, disputed, or unverified — never
          silently trusted). Even so, networks change their listings, run out
          of open slots, or update requirements faster than any automated or
          crowd-sourced system can catch. Treat every listing here as a lead
          to verify by phone or by visiting the network&apos;s own site — not
          a guarantee of anything.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">
          Other places to look
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This tool doesn&apos;t try to be the only resource — it&apos;s worth
          cross-referencing against{" "}
          <a
            href="https://jalr.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
          >
            Just Another Lab Rat (jalr.org)
          </a>
          , a long-running community-run clinic directory, its{" "}
          <a
            href="http://jalr.proboards.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
          >
            community forum
          </a>{" "}
          where actual participants compare notes, and{" "}
          <a
            href="https://studyscavenger.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
          >
            Study Scavenger
          </a>
          . See the{" "}
          <Link
            href="/networks"
            className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
          >
            network directory
          </Link>{" "}
          for more.
        </p>
      </section>

      <p className="pt-4 text-xs text-muted-foreground">
        <Link
          href="/"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          ← Back to the ranked table
        </Link>
      </p>
    </main>
  );
}
