"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Study } from "@/lib/types";
import { loadUserStudies } from "@/lib/profile-store";
import { ChasePipelineTable } from "@/components/chase-pipeline-table";
import { DoTodayQueue } from "@/components/do-today-queue";
import studiesSeed from "@/data/studies.seed.json";

// docs/APPLICATION-TRACKING.md "UI" section: "Lives alongside the ranked
// net-value table (same studies, two lenses: should I? vs where is it?)".
// Same real, public seed data as app/page.tsx (data/studies.seed.json) plus
// this visitor's own "add study by URL" entries (lib/profile-store.ts) --
// the exact same study universe the ranked table works from, so a study
// tracked here is always the same record shown there.
const STUDIES = studiesSeed.studies as unknown as Study[];

export default function ChasePage() {
  const [userStudies, setUserStudies] = useState<Study[]>([]);

  useEffect(() => {
    setUserStudies(loadUserStudies());
  }, []);

  const allStudies = useMemo(() => [...STUDIES, ...userStudies], [userStudies]);

  return (
    <div className="min-h-screen space-y-6 p-6 pb-20 sm:p-10">
      <header className="mx-auto max-w-[1100px] space-y-2">
        <Link
          href="/"
          className="font-mono text-[0.68rem] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          &larr; back to the ranked tracker
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Chase pipeline</h1>
        <p className="max-w-[70ch] text-sm text-muted-foreground">
          Same studies, a different lens: not &ldquo;should I apply&rdquo; but
          &ldquo;where is each application right now, and what do I do
          next.&rdquo; Applying isn&apos;t getting in -- the chaser gets the
          slot. Tracks status, next action, tap-to-call, and the call-log
          detail per study, entirely in your own browser, same as the rest of
          this tool -- nothing here is sent to a server.
        </p>
      </header>

      <div className="mx-auto max-w-[1100px] space-y-10">
        <DoTodayQueue studies={allStudies} />
        <ChasePipelineTable studies={allStudies} />
      </div>
    </div>
  );
}
