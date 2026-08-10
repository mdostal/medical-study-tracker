"use client";

import { useEffect, useMemo, useState } from "react";
import type { Application, Study, Urgency } from "@/lib/types";
import { loadApplications, saveApplications } from "@/lib/application-store";
import { isCallableNow } from "@/lib/business-hours";
import {
  STALE_AFTER_BUSINESS_DAYS,
  applyStaleFlip,
  selectCohortDeadlineAlerts,
  selectDoTodayQueue,
  selectReCallPrompts,
} from "@/lib/chase-nudges";
import { fmtGross } from "@/lib/format";
import { cn } from "@/lib/utils";

// The prioritized "Do today" queue + nudges (docs/APPLICATION-TRACKING.md
// "Chase workflow & nudges"): studies where chase_state=on_me AND callable
// now, cohort-deadline alerts surfaced loudly, and a client-side
// stale-detection pass that flips chase_state=waiting -> stale after
// lib/chase-nudges.ts's STALE_AFTER_BUSINESS_DAYS with no movement. Reads
// the same lib/application-store.ts { study_id: Application } map
// components/chase-pipeline-table.tsx reads, joined against the same study
// list (app/chase/page.tsx passes both to this component and to
// ChasePipelineTable). Every example/placeholder value in this file is a
// generic, obviously-fictional placeholder -- never sourced from the user's
// own reference chase-list artifact (this story's PII acceptance criterion).
//
// Owns its own applications state the same self-contained way
// ChasePipelineTable owns its own -- there's no cross-component
// notify-on-change event in this app yet (see that component's own header
// comment), so a status change made in one view isn't reflected in the
// other until the next full load/mount. Acceptable for this story: the
// stale-flip persistence below still writes through the shared
// lib/application-store.ts, so the *data* stays correct even though this
// particular render doesn't live-sync across components.

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

interface Row {
  study: Study;
  application: Application;
}

function joinRows(studies: Study[], applications: Application[]): Row[] {
  const byId = new Map(studies.map((s) => [s.id, s]));
  return applications
    .map((application) => {
      const study = byId.get(application.study_id);
      return study ? { study, application } : null;
    })
    .filter((r): r is Row => r !== null);
}

function UrgencyBadge({ urgency }: { urgency?: Urgency }) {
  if (!urgency || urgency === "normal") {
    return (
      <span className="inline-block rounded border border-border px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
        normal
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-block rounded border px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-wide",
        urgency === "now"
          ? "border-red-600/40 bg-red-500/10 text-red-700 dark:text-red-400"
          : "border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      )}
    >
      {urgency === "now" ? "now" : "this week"}
    </span>
  );
}

// The self_book Self-book-first action is always a direct scheduler link
// (docs "no waiting"); channel=call/other actions are a tap-to-call link
// (docs tel: pattern, mirrors components/chase-pipeline-table.tsx's
// PhoneLink) or a plain reminder when there's no phone/scheduler on file.
function DoTodayAction({ application }: { application: Application }) {
  const { channel, contact } = application;

  if (channel === "self_book" && contact.scheduler_url) {
    return (
      <a
        href={contact.scheduler_url}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded border border-emerald-600/40 px-1.5 py-0.5 font-mono text-[0.62rem] text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
      >
        Book directly &rarr;
      </a>
    );
  }

  if (contact.phone) {
    return (
      <a
        href={telHref(contact.phone)}
        className="inline-block font-mono text-[0.68rem] font-semibold text-sky-700 underline decoration-sky-600/40 underline-offset-2 hover:decoration-foreground dark:text-sky-400"
      >
        Call {contact.phone}
      </a>
    );
  }

  return (
    <span className="font-mono text-[0.62rem] text-muted-foreground">
      {application.next_action ?? "no phone/scheduler on file"}
    </span>
  );
}

// docs "Cohort-deadline alerts ... Missing a cohort window = losing the
// slot" -- genuinely loud (this story's own acceptance criterion): a
// standalone bordered card, not just a badge sitting inline in a list row.
function CohortDeadlineAlerts({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">
        Cohort deadline{rows.length > 1 ? "s" : ""} -- don&apos;t lose the slot
      </h2>
      <ul className="space-y-2">
        {rows.map(({ study, application }) => (
          <li
            key={study.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-red-600/50 bg-red-500/10 p-3 dark:border-red-500/50"
          >
            <div className="min-w-0">
              <div className="font-semibold text-red-800 dark:text-red-300">{study.id}</div>
              <div className="font-mono text-[0.7rem] text-red-700 dark:text-red-400">
                {study.network} &middot; {study.city}, {study.state} &middot; due{" "}
                {application.next_action_due}
              </div>
            </div>
            <DoTodayAction application={application} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReCallPrompts({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Gone quiet -- re-call ({rows.length})
      </h2>
      <ul className="space-y-2">
        {rows.map(({ study, application }) => (
          <li
            key={study.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-amber-600/40 bg-amber-500/5 p-3"
          >
            <div className="min-w-0">
              <div className="font-medium">{study.id}</div>
              <div className="font-mono text-[0.7rem] text-muted-foreground">
                {study.network} &middot; no movement in {STALE_AFTER_BUSINESS_DAYS}+ business days
                -- worth a re-call
              </div>
            </div>
            <DoTodayAction application={application} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DoTodayList({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
        Nothing to do right now -- either everything&apos;s waiting on them, or
        it&apos;s outside business hours for every clinic still on you.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map(({ study, application }) => {
        const hours = isCallableNow(application.contact.tz);
        return (
          <li
            key={study.id}
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3",
              application.urgency === "now" && "border-red-600/30 bg-red-500/[0.04]",
            )}
          >
            <div className="min-w-0">
              <div className="font-medium">{study.id}</div>
              <div className="font-mono text-[0.7rem] text-muted-foreground">
                {study.network} &middot; {study.city}, {study.state} &middot;{" "}
                {fmtGross(study.pay_gross, study.currency)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <UrgencyBadge urgency={application.urgency} />
              {application.channel !== "self_book" && (
                <span
                  className={cn(
                    "inline-block rounded border px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-wide",
                    hours.callable
                      ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {hours.callable ? "callable now" : "hours unknown"}
                </span>
              )}
              <DoTodayAction application={application} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function DoTodayQueue({ studies }: { studies: Study[] }) {
  const [applications, setApplications] = useState<Record<string, Application>>({});
  const [hydrated, setHydrated] = useState(false);

  // Stale-detection runs client-side on load (this story's own acceptance
  // criterion: "no scheduled job needed -- this is personal localStorage
  // data, not the shared scraped dataset"). Any newly-stale entries are
  // persisted immediately so the flip survives a reload and every other
  // consumer of lib/application-store.ts (e.g. ChasePipelineTable) sees it
  // next time it loads too.
  useEffect(() => {
    const loaded = loadApplications();
    const { applications: flipped, flippedIds } = applyStaleFlip(loaded);
    if (flippedIds.length > 0) {
      saveApplications(flipped);
    }
    setApplications(flipped);
    setHydrated(true);
  }, []);

  const allRows = useMemo(
    () => joinRows(studies, Object.values(applications)),
    [studies, applications],
  );

  const doTodayRows = useMemo(() => {
    const eligible = selectDoTodayQueue(allRows.map((r) => r.application));
    const byId = new Map(allRows.map((r) => [r.application.study_id, r]));
    return eligible.map((a) => byId.get(a.study_id)!).filter(Boolean);
  }, [allRows]);

  const cohortAlertRows = useMemo(() => {
    const alerts = selectCohortDeadlineAlerts(allRows.map((r) => r.application));
    const byId = new Map(allRows.map((r) => [r.application.study_id, r]));
    return alerts.map((a) => byId.get(a.study_id)!).filter(Boolean);
  }, [allRows]);

  const reCallRows = useMemo(() => {
    const prompts = selectReCallPrompts(allRows.map((r) => r.application));
    const byId = new Map(allRows.map((r) => [r.application.study_id, r]));
    return prompts.map((a) => byId.get(a.study_id)!).filter(Boolean);
  }, [allRows]);

  if (!hydrated) return null;

  if (allRows.length === 0) return null;

  return (
    <div className="space-y-6">
      <CohortDeadlineAlerts rows={cohortAlertRows} />

      <section className="space-y-2">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Do today ({doTodayRows.length})
        </h2>
        <DoTodayList rows={doTodayRows} />
      </section>

      <ReCallPrompts rows={reCallRows} />
    </div>
  );
}
