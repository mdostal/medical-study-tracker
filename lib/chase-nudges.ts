// "Do today" queue + nudge logic (docs/APPLICATION-TRACKING.md "Chase
// workflow & nudges"). Framework-free (no React/Next.js imports), matching
// lib/business-hours.ts's / lib/scoring.ts's own convention -- pure
// functions of (applications, now) so this is fully unit-testable without a
// DOM or a faked system clock (the caller passes `new Date()` at render/load
// time). Every example/placeholder value anywhere in this file or its tests
// is a generic, obviously-fictional placeholder -- never sourced from the
// user's own reference chase-list artifact (this story's PII acceptance
// criterion).

import { isCallableNow } from "./business-hours";
import type { Application, Urgency } from "./types";

// docs "Follow-up cadence: if waiting and no movement in N days -> flip to
// stale". Docs deliberately leave N unspecified ("developer picks a
// sensible default... and documents the choice" -- this story's own
// acceptance criterion). 6 *business* days (a bit over one work week) is
// long enough that a single slow callback isn't mistaken for "gone quiet",
// short enough that a cohort seat doesn't sit un-chased for two calendar
// weeks. Business days, not calendar days, because recruiting itself only
// moves on business days (lib/business-hours.ts) -- weekends shouldn't
// count toward "no movement". Not claimed as authoritative (this story's
// own risk register: "an arbitrary stale-days threshold might not match
// real recruiting cadence" -- low-stakes, personal nudge only, freely
// adjustable in this one place.
export const STALE_AFTER_BUSINESS_DAYS = 6;

const URGENCY_RANK: Record<Urgency, number> = { now: 0, this_week: 1, normal: 2 };

function urgencyRank(u: Urgency | undefined): number {
  return u ? URGENCY_RANK[u] : URGENCY_RANK.normal;
}

/** Sorts urgency-first (now < this_week < normal); study id as a stable tiebreaker. */
export function byUrgencyThenStudyId<T extends { study_id: string; urgency?: Urgency }>(
  a: T,
  b: T,
): number {
  return urgencyRank(a.urgency) - urgencyRank(b.urgency) || a.study_id.localeCompare(b.study_id);
}

/**
 * Is this application eligible for the "Do today" queue right now? docs:
 * "studies where chase_state = on_me AND the clinic is callable now
 * (business hours in its tz)" -- EXCEPT `channel = self_book`, which docs'
 * "Self-book first" rule carves out explicitly: "the action is a direct
 * scheduler link, no waiting" -- booking your own slot isn't time-gated the
 * way a phone call is, so a self_book application qualifies purely on
 * chase_state, independent of business hours (this story's own acceptance
 * criterion).
 */
export function isDoTodayNow(application: Application, now: Date = new Date()): boolean {
  if (application.chase_state !== "on_me") return false;
  if (application.channel === "self_book") return true;
  return isCallableNow(application.contact.tz, now).callable;
}

/** Filters + sorts the full application list down to the "Do today" queue, urgency-first. */
export function selectDoTodayQueue(
  applications: readonly Application[],
  now: Date = new Date(),
): Application[] {
  return applications.filter((a) => isDoTodayNow(a, now)).sort(byUrgencyThenStudyId);
}

/**
 * Cohort-deadline alert: docs "Cohort-deadline alerts: urgency=now +
 * next_action_due -> surface loudly ... Missing a cohort window = losing
 * the slot." Both conditions are required -- a `this_week`/`normal` study
 * isn't about to lose its slot today even if it happens to carry a due
 * date, and `urgency=now` alone (no due date) has nothing concrete to
 * countdown against. An unparseable next_action_due is treated as "no
 * usable deadline" rather than an alert.
 */
export function isCohortDeadlineAlert(application: Application): boolean {
  if (application.urgency !== "now") return false;
  if (!application.next_action_due) return false;
  return !Number.isNaN(new Date(application.next_action_due).getTime());
}

/** All cohort-deadline alerts in the list, urgency/id-sorted (docs "surface loudly"). */
export function selectCohortDeadlineAlerts(applications: readonly Application[]): Application[] {
  return applications.filter(isCohortDeadlineAlert).sort(byUrgencyThenStudyId);
}

/**
 * Count of business days (Mon-Fri) strictly between two calendar days --
 * i.e. how many weekday boundaries have been crossed getting from `from` to
 * `to`. Deliberately calendar-day-only (UTC, no time-of-day component) so
 * it's DST-agnostic by construction -- unlike lib/business-hours.ts's
 * isCallableNow (a point-in-time local-hour check), this only ever counts
 * whole elapsed days, so there's no local-hour boundary to get wrong. A
 * `to` at or before `from` returns 0 (never negative).
 */
export function businessDaysBetween(from: Date, to: Date): number {
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  let count = 0;
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay(); // 0 = Sun, 6 = Sat
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

/**
 * The most recent date this application actually moved: the latest
 * call_log entry, falling back to applied_date if there's no call log yet.
 * Returns null when there's no date to judge staleness from at all (a
 * brand-new `waiting` application with neither) -- callers treat that as
 * "not enough data to call it stale," never as an implicit "infinitely
 * stale."
 */
function lastMovementDate(application: Application): Date | null {
  const candidates: string[] = application.call_log.map((entry) => entry.date);
  if (application.applied_date) candidates.push(application.applied_date);

  let latest: Date | null = null;
  for (const raw of candidates) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  return latest;
}

/**
 * Should this application flip from `waiting` to `stale` right now? docs
 * "Follow-up cadence: if waiting and no movement in N days -> flip to
 * stale, prompt a re-call." Only ever considers `chase_state === "waiting"`
 * -- `on_me` (the visitor's own move, not a stall on the clinic's side),
 * `stale` (already flipped), and `done` are all left untouched.
 */
export function isStale(application: Application, now: Date = new Date()): boolean {
  if (application.chase_state !== "waiting") return false;
  const last = lastMovementDate(application);
  if (!last) return false;
  return businessDaysBetween(last, now) >= STALE_AFTER_BUSINESS_DAYS;
}

export interface StaleFlipResult {
  /** Full map, same keys as the input, with newly-stale entries' chase_state set to "stale". */
  applications: Record<string, Application>;
  /** study_ids that flipped on THIS pass -- empty when nothing changed. */
  flippedIds: string[];
}

/**
 * Client-side stale-detection pass (docs "Follow-up cadence" + this story's
 * own acceptance criterion: "runs client-side on page load/view -- no
 * scheduled job needed, this is personal localStorage data, not the shared
 * scraped dataset"). Pure: takes the full applications map, returns a NEW
 * map with any newly-stale entries flipped, plus the ids that flipped so
 * the caller can persist (lib/application-store.ts's upsertApplication/
 * saveApplications) and surface a re-call prompt. Entries that don't need
 * flipping keep the SAME object reference (not cloned), so a caller can
 * cheaply detect "nothing changed" via `flippedIds.length === 0` without a
 * deep-equal check.
 */
export function applyStaleFlip(
  applications: Record<string, Application>,
  now: Date = new Date(),
): StaleFlipResult {
  const flippedIds: string[] = [];
  const next: Record<string, Application> = {};
  for (const [studyId, application] of Object.entries(applications)) {
    if (isStale(application, now)) {
      next[studyId] = { ...application, chase_state: "stale" };
      flippedIds.push(studyId);
    } else {
      next[studyId] = application;
    }
  }
  return { applications: next, flippedIds };
}

/** Applications currently needing a re-call prompt (chase_state = stale), urgency-sorted. */
export function selectReCallPrompts(applications: readonly Application[]): Application[] {
  return applications.filter((a) => a.chase_state === "stale").sort(byUrgencyThenStudyId);
}
