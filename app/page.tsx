"use client";

import { useEffect, useMemo, useState } from "react";
import type { Application, Assumptions, BackupCareHub, FriendMap, Profile, SortKey, Study } from "@/lib/types";
import { DEFAULT_ASSUMPTIONS, DEFAULT_PROFILE, DEFAULT_SORT_KEY, sanitizePersistedState } from "@/lib/types";
import { scoreAll } from "@/lib/scoring";
import { addUserStudy, loadPersistedState, loadUserStudies, savePersistedState } from "@/lib/profile-store";
import { loadApplications } from "@/lib/application-store";
import { applyPersonalOverlay } from "@/lib/personal-overlay";
import { decodeShareState, SHARE_PARAM } from "@/lib/share-link";
import { AddStudyForm } from "@/components/add-study-form";
import { APPLICATION_CHANGE_EVENT } from "@/components/call-log-form";
import { isDefaultProfile, ProfilePanel } from "@/components/profile-panel";
import { RankedTable, sortEligible } from "@/components/ranked-table";
import { ShareButton } from "@/components/share-button";
import { StackSuggesterPanel } from "@/components/stack-suggester-panel";
import studiesSeed from "@/data/studies.seed.json";
import friendChildcareMap from "@/data/friend-childcare-map.json";
import communityCorrectionsFile from "@/data/community-corrections.json";
import { sanitizeCommunityCorrectionsFile } from "@/lib/community-overlay";
import { cn } from "@/lib/utils";

// Real, public seed data (data/studies.seed.json) — not fabricated, per
// docs/DATA-INTEGRITY.md. The `_comment` key is metadata, not a study.
const STUDIES = studiesSeed.studies as unknown as Study[];

// Story community-corrections-consensus: data/community-corrections.json is a
// GENERATED overlay (scripts/aggregate-corrections.mjs, run on a schedule by
// .github/workflows/aggregate-corrections.yml) — sanitized once at module
// load the same way STUDIES above is treated as trusted-but-defensively-typed
// JSON, then handed to RankedTable as a plain read-only prop. This file never
// gets written to from the browser and data/studies.seed.json is never
// touched by it — the two stay separate on disk; this is the one place they
// join, at render time, per lib/community-overlay.ts's own header comment.
const COMMUNITY_OVERLAY = sanitizeCommunityCorrectionsFile(communityCorrectionsFile);

// Hub coordinates (for lib/scoring.ts's real drivable-vs-fly distance
// check) — pulled straight from data/friend-childcare-map.json, itself real
// non-guessed data (see that file's own _comment). Its backup_care_available
// ships permanently empty (2026-08-09 incident — see the file's header
// comment): this app never ships or guesses per-hub free-coverage data.
// story: configurable-backup-care-coverage — the ONLY thing that ever
// populates backup_care_available is a visitor's own persisted
// backup_care_hubs, merged in at render time below (effectiveFriendMap).
// This module-level FRIEND_MAP is the static, always-empty-for-coverage
// source of truth; it is never passed to scoreAll() directly.
const FRIEND_MAP: FriendMap = {
  hubs: friendChildcareMap.hubs as FriendMap["hubs"],
  backup_care_available: friendChildcareMap.backup_care_available as FriendMap["backup_care_available"],
};

// Full list of hubs a visitor can pick from in the Profile panel's "your own
// free coverage" control (only ever shown once has_dependents_needing_care
// is on) — every hub in the static map, NOT filtered by
// backup_care_available (which is always empty). Selecting one just means
// "I personally have coverage here", nothing about the location itself.
const AVAILABLE_BACKUP_CARE_HUBS = Object.entries(FRIEND_MAP.hubs).map(([hub, point]) => ({
  hub,
  city: point.city,
}));

export default function Home() {
  // story: editable-profile — this visitor's own BMI/weight/sex/age/smoker,
  // restored/persisted/share-linked in the exact same PersistedState flow as
  // assumptions/sortKey below (lib/types.ts's sanitizePersistedState). Starts
  // at DEFAULT_PROFILE (the example profile) on every render including SSR,
  // same as assumptions starting at DEFAULT_ASSUMPTIONS.
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [assumptions, setAssumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT_KEY);
  // story: configurable-backup-care-coverage — THIS visitor's own stated
  // free-coverage hubs, defaulting to empty (restored below in the same
  // hydrate effect as assumptions/sortKey, and share-link-encodable exactly
  // like them since it lives in PersistedState).
  const [backupCareHubs, setBackupCareHubs] = useState<string[]>([]);
  // Visitor's own "add study by URL" entries (story: add-study-by-url) —
  // starts empty on every render (including SSR) and is restored from
  // lib/profile-store.ts in the same hydrate effect below, same
  // restore-once-on-mount pattern as assumptions/sortKey just above. Never
  // encoded into a share link (unlike Profile/Assumptions) — these are the
  // visitor's own local additions, not part of the shareable view.
  const [userStudies, setUserStudies] = useState<Study[]>([]);

  // story: call-log-writeback — THIS visitor's own confirmed call-log data
  // (lib/application-store.ts's { study_id: Application } map), restored in
  // the same hydrate effect as everything else below and re-read whenever
  // components/call-log-form.tsx saves a new entry (APPLICATION_CHANGE_EVENT,
  // same same-tab-notification pattern as lib/local-status-store.ts's own
  // STATUS_CHANGE_EVENT). Never encoded into a share link (unlike
  // Profile/Assumptions) — this is private, per-visitor call-log data, not
  // part of the shareable view, same posture as userStudies just above.
  const [applications, setApplications] = useState<Record<string, Application>>({});

  // Restore-once-on-mount: a share link's `?s=` param wins over localStorage
  // (an explicit link someone sent you should reproduce what they saw, not
  // silently merge with whatever you already had saved), and localStorage
  // wins over the built-in defaults. Runs client-side only (window/
  // localStorage aren't available during SSR) — initial render uses the
  // defaults above, then this effect restores the real state on first paint
  // in the browser, same pattern as components/status-pill.tsx.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const search = window.location.search;
    const hasShareParam = new URLSearchParams(search).has(SHARE_PARAM);
    const restored = hasShareParam
      ? decodeShareState(search)
      : (loadPersistedState() ?? sanitizePersistedState(undefined));
    setProfile(restored.profile);
    setAssumptions(restored.assumptions);
    setSortKey(restored.sortKey);
    setBackupCareHubs(restored.backup_care_hubs);
    setUserStudies(loadUserStudies());
    setApplications(loadApplications());
    setHydrated(true);
  }, []);

  // story: call-log-writeback — re-read the Application map whenever a
  // call-log entry is saved anywhere on the page (a future per-study drawer,
  // story: chase-pipeline-view). This component never writes to
  // lib/application-store.ts itself — components/call-log-form.tsx owns
  // every write; this effect only reacts to the same-tab notification it
  // dispatches after one.
  useEffect(() => {
    function onApplicationsChanged() {
      setApplications(loadApplications());
    }
    window.addEventListener(APPLICATION_CHANGE_EVENT, onApplicationsChanged);
    return () => window.removeEventListener(APPLICATION_CHANGE_EVENT, onApplicationsChanged);
  }, []);

  // Persist every subsequent change back to localStorage — but only after
  // the restore effect above has run once, so we don't clobber a
  // freshly-restored value with the pre-restore default on the very first
  // render.
  useEffect(() => {
    if (!hydrated) return;
    savePersistedState({ profile, assumptions, sortKey, backup_care_hubs: backupCareHubs });
  }, [hydrated, profile, assumptions, sortKey, backupCareHubs]);

  // lib/scoring.ts's scoreAll() is the single source of scored/ranked
  // output — this component never re-derives net_cash, feasibility, etc.
  // itself. Re-runs live in the browser on every Profile-panel change, and
  // on every "add study by URL" addition. userStudies are appended (never
  // mutate STUDIES itself) — scoreAll/isEligible treat them exactly like
  // seed data except for the `user_added` flag ranked-table.tsx reads to
  // render the "unverified" badge (AC4).
  const allStudies = useMemo(() => [...STUDIES, ...userStudies], [userStudies]);

  // story: call-log-writeback — this visitor's own confirmed call-log data
  // overrides the base seed's unconfirmed/estimated values (nights, payout
  // timing, washout, stipend, BMI-fit) BEFORE scoring, per
  // lib/personal-overlay.ts's own header comment. Scoped to this visitor's
  // localStorage only (`applications`) — data/studies.seed.json itself is
  // never touched (AC4), and lib/scoring.ts stays completely unmodified:
  // this only changes scoreAll()'s Study[] *input*, never its logic (AC3 +
  // this story's review step). A visitor who never logs a call has an empty
  // `applications` map, so personallyConfirmedStudies is value-identical to
  // allStudies and every downstream computation is unchanged.
  const personallyConfirmedStudies = useMemo(
    () => applyPersonalOverlay(allStudies, applications),
    [allStudies, applications],
  );

  // story: configurable-backup-care-coverage — the runtime merge. The
  // static FRIEND_MAP.backup_care_available is (and must stay) permanently
  // empty; this visitor's own persisted backup_care_hubs is the ONLY thing
  // that ever populates backup_care_available for scoring. Hub codes that
  // don't exist in FRIEND_MAP.hubs are silently ignored (e.g. stale/garbage
  // from a malformed share link). A fresh visitor with no configured hubs
  // gets back the exact same empty map FRIEND_MAP already has — no free
  // coverage anywhere until they add one themselves.
  const effectiveFriendMap = useMemo<FriendMap>(() => {
    const backup_care_available: Record<string, BackupCareHub> = {};
    for (const hub of backupCareHubs) {
      if (hub in FRIEND_MAP.hubs) {
        backup_care_available[hub] = {
          note: "You said you personally have coverage here — not a fact about this clinic or city.",
        };
      }
    }
    return { hubs: FRIEND_MAP.hubs, backup_care_available };
  }, [backupCareHubs]);

  const { eligible, blocked } = useMemo(
    () => scoreAll(personallyConfirmedStudies, profile, assumptions, effectiveFriendMap),
    [personallyConfirmedStudies, profile, assumptions, effectiveFriendMap],
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
          — pay minus travel minus backup care (childcare, pet-sitting, elder
          care, or whatever coverage you need), using your own assumptions
          below. Change the knobs and the ranking re-sorts instantly. This
          tool works fully anonymously: nothing you enter here is sent to a
          server, there is no sign-in of any kind, and everything runs
          client-side in your browser.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {/* story: editable-profile — this used to be static "Example
              profile: BMI 22 / Male · non-smoker" text, unconditionally, even
              after local-persistence-share-links landed: eligibility was
              ALWAYS computed against that hardcoded example, never the
              visitor's own numbers. Now reflects whichever is actually true. */}
          <span
            className={cn(
              "rounded-md border px-2 py-1 font-mono text-[0.66rem]",
              isDefaultProfile(profile)
                ? "border-amber-600/40 bg-amber-500/10 font-semibold text-amber-700 dark:text-amber-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            {isDefaultProfile(profile)
              ? "Using the example profile (BMI 22, male, non-smoker) — edit yours below"
              : `Your profile: BMI ${profile.bmi} · ${profile.sex} · ${profile.smoker ? "smoker" : "non-smoker"}`}
          </span>
          <span className="rounded-md border bg-muted px-2 py-1 font-mono text-[0.66rem] text-muted-foreground">
            No account, no sign-in — 100% anonymous
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-6">
        <ProfilePanel
          profile={profile}
          onProfileChange={setProfile}
          assumptions={assumptions}
          onChange={setAssumptions}
          sortKey={sortKey}
          onSortKeyChange={setSortKey}
          onReset={() => {
            setProfile(DEFAULT_PROFILE);
            setAssumptions(DEFAULT_ASSUMPTIONS);
            setSortKey(DEFAULT_SORT_KEY);
            setBackupCareHubs([]);
          }}
          availableBackupCareHubs={AVAILABLE_BACKUP_CARE_HUBS}
          backupCareHubs={backupCareHubs}
          onBackupCareHubsChange={setBackupCareHubs}
        />

        <div className="flex justify-end">
          <ShareButton state={{ profile, assumptions, sortKey, backup_care_hubs: backupCareHubs }} />
        </div>

        <AddStudyForm onAdd={(study) => setUserStudies(addUserStudy(study))} />

        <StackSuggesterPanel eligible={eligible} />

        <RankedTable
          eligible={ranked}
          blocked={blocked}
          profile={profile}
          maxAwayNights={assumptions.max_away_nights}
          communityOverlay={COMMUNITY_OVERLAY}
        />
      </div>
    </div>
  );
}
