"use client";

import { Fragment, useEffect, useState } from "react";
import type {
  Application,
  ApplicationChannel,
  LifecycleStatus,
  Study,
  Urgency,
} from "@/lib/types";
import { LIFECYCLE_PIPELINE, TERMINAL_LIFECYCLE_STATUSES } from "@/lib/types";
import {
  APPLICATION_CHANGE_EVENT,
  loadApplications,
  upsertApplication,
} from "@/lib/application-store";
import { isCallableNow } from "@/lib/business-hours";
import { fmtGross, fmtUSD } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CallLogForm } from "@/components/call-log-form";
import { cn } from "@/lib/utils";

// Per-study Chase/Pipeline view (docs/APPLICATION-TRACKING.md "UI" section):
// "same studies, two lenses -- should I? vs where is it?" Reads
// lib/application-store.ts's { study_id: Application } map and joins it
// against the study list this app already scores/ranks (app/chase/page.tsx
// passes both seed + the visitor's own added studies, same set
// components/ranked-table.tsx works from). Every example/placeholder value
// in this file is a generic, obviously-fictional placeholder (fictional
// 555-01xx range, no real name, no real biometric figure) -- never sourced
// from the user's own reference chase-list artifact, per this story's PII
// acceptance criterion.
//
// Owns its own applications state (loaded on mount, mutated in place on a
// status-cycle click) the same self-contained way
// components/status-pill.tsx owns lib/local-status-store.ts's map --
// there's exactly one consumer of lib/application-store.ts in this app right
// now, so there's no cross-component "notify on change" event to wire up
// the way components/ranked-table.tsx listens for STATUS_CHANGE_EVENT.

// Index-aligned with LIFECYCLE_PIPELINE (lib/types.ts) -- stage i's label
// here describes stage i's array there.
const STAGE_LABELS: readonly string[] = [
  "Identified",
  "Applied / booked",
  "Phone screen",
  "Screening scheduled",
  "Screened",
  "Qualified / offered",
  "Enrolled",
  "Dosing",
  "Paid",
];

const CHANNEL_LABEL: Record<ApplicationChannel, string> = {
  self_book: "self-book",
  call: "call",
  apply_form_fillout: "apply form",
  syndicated_external: "syndicated",
};

const URGENCY_RANK: Record<Urgency, number> = { now: 0, this_week: 1, normal: 2 };

function urgencyRank(u: Urgency | undefined): number {
  return u ? URGENCY_RANK[u] : URGENCY_RANK.normal;
}

/** Which pipeline stage (LIFECYCLE_PIPELINE index) a status belongs to, or -1 for a terminal off-ramp. */
function stageIndexFor(status: LifecycleStatus): number {
  for (let i = 0; i < LIFECYCLE_PIPELINE.length; i++) {
    if ((LIFECYCLE_PIPELINE[i] as readonly LifecycleStatus[]).includes(status)) return i;
  }
  return -1;
}

/** Advances one step through the funnel stages, wrapping back to the start -- same click-to-cycle convention as lib/local-status-store.ts's cycleStatus. A terminal (off-ramp) status also wraps back to the funnel start, since off-ramps aren't part of the cyclable sequence. */
function cycleLifecycleStatus(current: LifecycleStatus): LifecycleStatus {
  const flat = LIFECYCLE_PIPELINE.flat();
  const idx = flat.indexOf(current);
  const next = idx === -1 ? 0 : (idx + 1) % flat.length;
  return flat[next];
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
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

// docs "business-hours-callable" indicator -- computed at render time from
// contact.tz, never hardcoded to any single timezone (this story's
// acceptance criterion). `known: false` (missing/unrecognized tz) renders
// distinctly from a real "closed now" answer rather than guessing a zone.
function BusinessHoursBadge({ tz }: { tz?: string }) {
  const result = isCallableNow(tz);
  if (!result.known) {
    return (
      <span className="inline-block rounded border border-dashed border-border px-1.5 py-0.5 font-mono text-[0.6rem] text-muted-foreground">
        hours unknown
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-block rounded border px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-wide",
        result.callable
          ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {result.callable ? "callable now" : "closed now"}
    </span>
  );
}

// A tap-to-call quick link, shown whenever contact.phone is set regardless
// of channel (this story's acceptance criterion is unconditional on channel
// -- "when a phone number exists").
function PhoneLink({ phone, label }: { phone: string; label: string }) {
  return (
    <a
      href={telHref(phone)}
      className="inline-block font-mono text-[0.68rem] font-semibold text-sky-700 underline decoration-sky-600/40 underline-offset-2 hover:decoration-foreground dark:text-sky-400"
    >
      {label} {phone}
    </a>
  );
}

// Channel-appropriate "do" action (docs "Self-book first: for channel =
// self_book, the action is a direct scheduler link, no waiting" / "some you
// call to push"). AC: self_book must render as contact.scheduler_url, never
// a phone-call prompt.
function DoAction({ application }: { application: Application }) {
  const { channel, contact, next_action } = application;

  if (channel === "self_book") {
    return (
      <div className="flex flex-col items-start gap-1">
        {contact.scheduler_url ? (
          <a
            href={contact.scheduler_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-emerald-600/40 px-1.5 py-0.5 font-mono text-[0.62rem] text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            Book directly &rarr;
          </a>
        ) : (
          <span className="font-mono text-[0.62rem] text-muted-foreground">
            no scheduler link on file
          </span>
        )}
        {contact.phone && <PhoneLink phone={contact.phone} label="or call" />}
      </div>
    );
  }

  if (channel === "call") {
    return (
      <div className="flex flex-col items-start gap-1">
        {contact.phone ? (
          <PhoneLink phone={contact.phone} label="Call to push" />
        ) : (
          <span className="font-mono text-[0.62rem] text-muted-foreground">no phone on file</span>
        )}
      </div>
    );
  }

  // apply_form_fillout / syndicated_external -- docs "no-email-confirmation
  // gap": no automatic record exists, so the reminder is manual, not a link.
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="inline-block rounded border border-amber-600/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[0.6rem] text-amber-700 dark:text-amber-400">
        no email confirmation
      </span>
      <span className="font-mono text-[0.62rem] text-muted-foreground">
        {next_action ?? "confirm submission manually"}
      </span>
      {contact.phone && <PhoneLink phone={contact.phone} label="or call" />}
    </div>
  );
}

function ChaseStatusPill({
  status,
  onCycle,
}: {
  status: LifecycleStatus;
  onCycle: () => void;
}) {
  const terminal = (TERMINAL_LIFECYCLE_STATUSES as readonly string[]).includes(status);
  return (
    <button
      type="button"
      onClick={onCycle}
      title="Click to advance status"
      className={cn(
        "select-none rounded border px-1.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-wide transition-colors",
        "border-border bg-muted text-muted-foreground hover:border-foreground/30 hover:text-foreground",
        (status === "paid" || status === "enrolled") &&
          "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        status === "dosing" &&
          "border-sky-600/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
        terminal && "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-400",
      )}
    >
      {status}
    </button>
  );
}

// Per-study drawer/detail (docs "Per-study drawer: the call log + the
// captured nights/payout/washout that fed the engine") -- an inline
// expand-in-place row rather than an overlay/side-drawer, so it never risks
// its own horizontal overflow on a 390px viewport (same overflow-x-auto
// discipline this table's own wide columns already rely on).
function DetailPanel({
  application,
  studyId,
  studyLabel,
}: {
  application: Application;
  studyId: string;
  studyLabel: string;
}) {
  const { confirmed, payout, washout_days, stipend_per_visit, notes, call_log } = application;
  const [logging, setLogging] = useState(false);
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3 text-[0.74rem]">
      {logging ? (
        <CallLogForm
          studyId={studyId}
          studyLabel={studyLabel}
          onClose={() => setLogging(false)}
        />
      ) : (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setLogging(true)}>
            Log a call
          </Button>
        </div>
      )}
      <div className="grid min-w-0 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        <div className="min-w-0">
          <span className="text-muted-foreground">Nights confirmed </span>
          {confirmed.nights && confirmed.nights.length > 0 ? confirmed.nights.join(", ") : "—"}
        </div>
        <div className="min-w-0">
          <span className="text-muted-foreground">Visits confirmed </span>
          {confirmed.visits ?? "—"}
        </div>
        <div className="min-w-0">
          <span className="text-muted-foreground">BMI ok </span>
          {confirmed.bmi_ok === undefined ? "—" : confirmed.bmi_ok ? "yes" : "no"}
        </div>
        <div className="min-w-0">
          <span className="text-muted-foreground">Payout </span>
          {payout ? `${payout.type} · ${payout.settle_days ?? "?"}d` : "—"}
        </div>
        <div className="min-w-0">
          <span className="text-muted-foreground">Washout </span>
          {washout_days != null ? `${washout_days}d` : "—"}
        </div>
        <div className="min-w-0">
          <span className="text-muted-foreground">Stipend / visit </span>
          {stipend_per_visit != null ? fmtUSD(stipend_per_visit) : "—"}
        </div>
      </div>

      {notes && <p className="text-muted-foreground">{notes}</p>}

      <div>
        <div className="mb-1 font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
          Call log
        </div>
        {call_log.length === 0 ? (
          <p className="text-muted-foreground">No calls logged yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {call_log.map((entry, i) => (
              <li key={i} className="min-w-0 border-l-2 border-border pl-2">
                <div className="font-mono text-[0.62rem] text-muted-foreground">
                  {entry.date} · {entry.who}
                </div>
                <div>{entry.summary}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed bg-card p-8 text-center">
      <p className="font-medium">Nothing in your chase pipeline yet</p>
      <p className="mx-auto mt-2 max-w-[55ch] text-sm text-muted-foreground">
        This view tracks studies you&apos;ve actually applied to or booked --
        status, next action, call log, and the details a screening call
        confirms (nights, payout timing, washout). It stays empty until you
        have an application in progress; once you do, it lives here, in your
        own browser only, same as everything else in this tool.
      </p>
    </div>
  );
}

interface Row {
  study: Study;
  application: Application;
}

export function ChasePipelineTable({ studies }: { studies: Study[] }) {
  const [applications, setApplications] = useState<Record<string, Application>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setApplications(loadApplications());
    setHydrated(true);
  }, []);

  // Refresh whenever a call log is saved (components/call-log-form.tsx,
  // rendered inline in DetailPanel below) or a status is cycled elsewhere
  // (components/do-today-queue.tsx) -- every write anywhere dispatches this
  // via lib/application-store.ts, so this view never goes stale without a
  // full reload.
  useEffect(() => {
    function onChange() {
      setApplications(loadApplications());
    }
    window.addEventListener(APPLICATION_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(APPLICATION_CHANGE_EVENT, onChange);
  }, []);

  function handleCycle(row: Row) {
    const next: Application = {
      ...row.application,
      status: cycleLifecycleStatus(row.application.status),
    };
    upsertApplication(row.study.id, next);
    setApplications((prev) => ({ ...prev, [row.study.id]: next }));
  }

  const byId = new Map(studies.map((s) => [s.id, s]));
  const rows: Row[] = Object.entries(applications)
    .map(([studyId, application]) => {
      const study = byId.get(studyId);
      return study ? { study, application } : null;
    })
    .filter((r): r is Row => r !== null);

  if (!hydrated || rows.length === 0) {
    return <EmptyState />;
  }

  const stageGroups: Row[][] = STAGE_LABELS.map(() => []);
  const closedGroup: Row[] = [];
  for (const row of rows) {
    const idx = stageIndexFor(row.application.status);
    if (idx === -1) closedGroup.push(row);
    else stageGroups[idx].push(row);
  }
  const byUrgencyThenId = (a: Row, b: Row) =>
    urgencyRank(a.application.urgency) - urgencyRank(b.application.urgency) ||
    a.study.id.localeCompare(b.study.id);
  stageGroups.forEach((g) => g.sort(byUrgencyThenId));
  closedGroup.sort(byUrgencyThenId);

  function StageSection({ label, rows }: { label: string; rows: Row[] }) {
    if (rows.length === 0) return null;
    return (
      <section className="space-y-2">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label} <span className="text-muted-foreground/70">({rows.length})</span>
        </h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="min-w-[820px] text-[0.78rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Study
                </TableHead>
                <TableHead className="text-right font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Pay
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Do
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Urgency
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Hours
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const isOpen = expandedId === row.study.id;
                return (
                  <Fragment key={row.study.id}>
                    <TableRow
                      className={cn(
                        row.application.urgency === "now" &&
                          "bg-red-500/[0.05] hover:bg-red-500/10",
                      )}
                    >
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setExpandedId(isOpen ? null : row.study.id)}
                          className="text-left font-medium underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
                        >
                          {row.study.id}
                        </button>
                        <div className="font-mono text-[0.62rem] text-muted-foreground">
                          {row.study.network} · {row.study.city}, {row.study.state} ·{" "}
                          {CHANNEL_LABEL[row.application.channel]}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {fmtGross(row.study.pay_gross, row.study.currency)}
                      </TableCell>
                      <TableCell>
                        <DoAction application={row.application} />
                      </TableCell>
                      <TableCell>
                        <UrgencyBadge urgency={row.application.urgency} />
                      </TableCell>
                      <TableCell>
                        <BusinessHoursBadge tz={row.application.contact.tz} />
                      </TableCell>
                      <TableCell>
                        <ChaseStatusPill
                          status={row.application.status}
                          onCycle={() => handleCycle(row)}
                        />
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="bg-transparent p-3">
                          <DetailPanel
                            application={row.application}
                            studyId={row.study.id}
                            studyLabel={row.study.id}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {stageGroups.map((rows, i) => (
        <StageSection key={STAGE_LABELS[i]} label={STAGE_LABELS[i]} rows={rows} />
      ))}
      <StageSection label="Closed / off-ramp" rows={closedGroup} />
    </div>
  );
}
