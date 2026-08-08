"use client";

import { useMemo, useState } from "react";
import type { Assumptions, FriendMap, Profile, Study } from "@/lib/types";
import { DEFAULT_ASSUMPTIONS } from "@/lib/types";
import { scoreAll } from "@/lib/scoring";
import { ProfilePanel } from "@/components/profile-panel";
import { RankedTable, sortEligible, type SortKey } from "@/components/ranked-table";
import studiesSeed from "@/data/studies.seed.json";
import friendChildcareMap from "@/data/friend-childcare-map.json";

// Real, public seed data (data/studies.seed.json) — not fabricated, per
// docs/DATA-INTEGRITY.md. The `_comment` key is metadata, not a study.
const STUDIES = studiesSeed.studies as unknown as Study[];

// Generic example profile — the entire app works fully anonymously (no
// sign-in of any kind exists, design-discussion.md §9). A real visitor's own
// profile lives only in their own browser's localStorage once
// local-persistence-share-links lands; until then this generic example is
// what every anonymous visitor sees, same as the prototype's own
// "Example profile" pills.
const DEMO_PROFILE: Profile = {
  bmi: 22,
  weight_lb: 170,
  sex: "male",
  age: 32,
  conditions: [],
};

// Only base_drive_hubs is real, non-guessed data (which hubs are a drivable
// trip from each example home base) — pulled straight from
// data/friend-childcare-map.json. Per-city childcare coverage is
// deliberately NEVER modeled from a map (see that file's own _comment and
// docs/SCORING.md §"Childcare cost"); lib/scoring.ts only ever derives
// childcare_cost from the user-controlled model_childcare + nanny_rate +
// friend_threshold_nights assumptions, never from a per-city guess. The
// remaining FriendMap fields aren't read by lib/scoring.ts today, so they
// stay structurally valid but empty rather than fabricated.
const FRIEND_MAP: FriendMap = {
  hubs: {},
  friend_metros: [],
  base_drive_hubs: friendChildcareMap.base_drive_hubs as Record<string, string[]>,
  home_base_childcare: {},
};

export default function Home() {
  const [assumptions, setAssumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [sortKey, setSortKey] = useState<SortKey>("score");

  // lib/scoring.ts's scoreAll() is the single source of scored/ranked
  // output — this component never re-derives net_cash, feasibility, etc.
  // itself. Re-runs live in the browser on every Profile-panel change.
  const { eligible, blocked } = useMemo(
    () => scoreAll(STUDIES, DEMO_PROFILE, assumptions, FRIEND_MAP),
    [assumptions],
  );

  const ranked = useMemo(() => sortEligible(eligible, sortKey), [eligible, sortKey]);

  return (
    <div className="min-h-screen space-y-6 p-6 pb-20 sm:p-10">
      <header className="mx-auto max-w-[1500px] space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Medical Study Tracker
        </h1>
        <p className="max-w-[70ch] text-sm text-muted-foreground">
          Live paid clinical-trial studies, ranked by{" "}
          <span className="font-medium text-foreground">
            what you actually keep
          </span>{" "}
          — pay minus travel minus childcare, using your own assumptions
          below. Change the knobs and the ranking re-sorts instantly. This
          tool works fully anonymously: nothing you enter here is sent to a
          server, there is no sign-in of any kind, and everything runs
          client-side in your browser.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <span className="rounded-md border bg-muted px-2 py-1 font-mono text-[0.66rem] text-muted-foreground">
            Example profile: BMI <b className="text-foreground">{DEMO_PROFILE.bmi}</b>
          </span>
          <span className="rounded-md border bg-muted px-2 py-1 font-mono text-[0.66rem] text-muted-foreground">
            Male · non-smoker
          </span>
          <span className="rounded-md border bg-muted px-2 py-1 font-mono text-[0.66rem] text-muted-foreground">
            No account, no sign-in — 100% anonymous
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-6">
        <ProfilePanel
          assumptions={assumptions}
          onChange={setAssumptions}
          sortKey={sortKey}
          onSortKeyChange={setSortKey}
          onReset={() => {
            setAssumptions(DEFAULT_ASSUMPTIONS);
            setSortKey("score");
          }}
        />

        <RankedTable
          eligible={ranked}
          blocked={blocked}
          profile={DEMO_PROFILE}
          maxAwayNights={assumptions.max_away_nights}
        />
      </div>
    </div>
  );
}
