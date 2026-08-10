"use client";

import { Fragment, useEffect, useState } from "react";
import type {
  Application,
  ApplicationChannel,
  ChaseState,
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

const STATUS_LABEL: Record<LifecycleStatus, string> = {
  identified: "Identified",
  applied: "Applied / submitted",
  booked: "Booked",
  "phone-screen": "Phone screen",
  "screening-scheduled": "Screening scheduled",
  screened: "Screened",
  qualified: "Qualified",
  offered: "Offered",
  enrolled: "Enrolled",
  dosing: "Dosing",
  paid: "Paid",
  "not-eligible": "Not eligible",
  declined: "Declined",
  "cohort-full": "Cohort full",
  closed: "Closed",
};

// "Whose move is it" -- separate axis from LifecycleStatus (lib/chase-nudges.ts
// reads this to build the Do-today queue and the stale/re-call prompt). Labeled
// in plain chase-workflow terms: submitted (on_me/waiting handoff already
// happened) -> waiting on them -> gone quiet, follow up (auto-flips here after
// STALE_AFTER_BUSINESS_DAYS with no movement) -> done.
const CHASE_STATE_LABEL: Record<ChaseState, string> = {
  on_me: "On me",
  waiting: "Waiting on them",
  stale: "Follow up (stale)",
  done: "Done",
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

const FLAT_PIPELINE: readonly LifecycleStatus[] = LIFECYCLE_PIPELINE.flat();

/** Moves one step forward/back through the funnel stages, clamped at both ends -- a stepper, not a cycle, so a click never skips past where you meant to land. A terminal (off-ramp) status has no pipeline index; either direction re-enters the pipeline at its start (use the dropdown to pick a terminal status directly). */
function stepLifecycleStatus(current: LifecycleStatus, direction: 1 | -1): LifecycleStatus {
  const idx = FLAT_PIPELINE.indexOf(current);
  if (idx === -1) return FLAT_PIPELINE[0];
  const next = idx + direction;
  if (next < 0 || next >= FLAT_PIPELINE.length) return current;
  return FLAT_PIPELINE[next];
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

// Forward/back nudge (one pipeline stage at a time) + a direct-choose dropdown
// listing every status -- replaces the old single "click to cycle through ALL
// statuses" button, which meant going from identified to paid took 8 clicks
// each rolling through everything in between.
function ChaseStatusPill({
  status,
  onStep,
  onSelect,
}: {
  status: LifecycleStatus;
  onStep: (direction: 1 | -1) => void;
  onSelect: (status: LifecycleStatus) => void;
}) {
  const terminal = (TERMINAL_LIFECYCLE_STATUSES as readonly string[]).includes(status);
  const idx = FLAT_PIPELINE.indexOf(status);
  const canBack = idx > 0;
  const canForward = idx !== -1 && idx < FLAT_PIPELINE.length - 1;
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={!canBack}
        title="Back one stage"
        className="rounded border border-border px-1 font-mono text-[0.62rem] leading-none text-muted-foreground hover:border-foreground/30 hover:text-foreground disabled:opacity-25"
      >
        &lsaquo;
      </button>
      <select
        value={status}
        onChange={(e) => onSelect(e.target.value as LifecycleStatus)}
        title="Choose status directly"
        className={cn(
          "select-none rounded border bg-muted px-1 py-0.5 font-mono text-[0.62rem] uppercase tracking-wide",
          "border-border text-muted-foreground",
          (status === "paid" || status === "enrolled") &&
            "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          status === "dosing" && "border-sky-600/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
          terminal && "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-400",
        )}
      >
        <optgroup label="Pipeline">
          {FLAT_PIPELINE.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </optgroup>
        <optgroup label="Closed / off-ramp">
          {TERMINAL_LIFECYCLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </optgroup>
      </select>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={!canForward}
        title="Forward one stage"
        className="rounded border border-border px-1 font-mono text-[0.62rem] leading-none text-muted-foreground hover:border-foreground/30 hover:text-foreground disabled:opacity-25"
      >
        &rsaquo;
      </button>
    </div>
  );
}

// "Whose move is it" control -- surfaces lib/chase-nudges.ts's chase_state
// axis, which previously had no editable UI anywhere: nothing ever set it to
// "waiting", so the Do-today queue's on_me filter and the stale/re-call
// auto-flip were both effectively dead in practice. This is the
// submitted -> waiting on them -> follow-up(stale) -> done loop.
function ChaseStatePill({
  state,
  onSelect,
}: {
  state: ChaseState;
  onSelect: (state: ChaseState) => void;
}) {
  return (
    <select
      value={state}
      onChange={(e) => onSelect(e.target.value as ChaseState)}
      title="Whose move is it"
      className={cn(
        "select-none rounded border bg-transparent px-1 py-0.5 font-mono text-[0.58rem] uppercase tracking-wide",
        state === "on_me" && "border-sky-600/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
        state === "waiting" && "border-border text-muted-foreground",
        state === "stale" &&
          "border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        state === "done" &&
          "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      {(Object.entries(CHASE_STATE_LABEL) as [ChaseState, string][]).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
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
  const { channel, confirmed, payout, washout_days, stipend_per_visit, notes, call_log } =
    application;
  const [logging, setLogging] = useState(false);
  // Form/syndicated channels never involve a phone call at all (e.g. a
  // "register your interest" web form) -- "log an update" reads honestly for
  // "I submitted / followed up / heard back", where "log a call" wouldn't.
  const logKind: "call" | "update" =
    channel === "apply_form_fillout" || channel === "syndicated_external" ? "update" : "call";
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3 text-[0.74rem]">
      {logging ? (
        <CallLogForm
          studyId={studyId}
          studyLabel={studyLabel}
          kind={logKind}
          onClose={() => setLogging(false)}
        />
      ) : (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setLogging(true)}>
            {logKind === "call" ? "Log a call" : "Log an update"}
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

  function patchApplication(row: Row, patch: Partial<Application>) {
    const next: Application = { ...row.application, ...patch };
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
                        <div className="flex flex-col items-start gap-1">
                          <ChaseStatusPill
                            status={row.application.status}
                            onStep={(direction) =>
                              patchApplication(row, {
                                status: stepLifecycleStatus(row.application.status, direction),
                              })
                            }
                            onSelect={(status) => patchApplication(row, { status })}
                          />
                          <ChaseStatePill
                            state={row.application.chase_state}
                            onSelect={(chase_state) => patchApplication(row, { chase_state })}
                          />
                        </div>
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
