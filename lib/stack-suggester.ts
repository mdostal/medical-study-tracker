// Stack suggester — best combination of studies to hit a cash target, per
// docs/REQUIREMENTS.md must-have #8. Ported from prototype/net-value-model.html's
// "Best stack right now" panel (which naively summed the top-2 studies by net
// value, with no date-collision or washout logic at all) and extended per the
// mid-planning washout acceptance criteria added to
// .pHive/epics/public-launch/stories/core-ui-stack-suggester.yaml (captured
// 2026-08-08): a real, database-enforced (cross-company, e.g. VCT/CTSdatabase)
// ~30-day minimum gap between one study's LAST dosing day and the next
// study's FIRST dosing day — not just a non-overlap courtesy buffer.
//
// Framework-free and pure, same convention as lib/scoring.ts, so it stays
// independently unit-testable from the UI (components/stack-suggester-panel.tsx
// is a thin shell over suggestStack()).
//
// Data-model note: Study (lib/types.ts) has no calendar dates — `stays` are
// relative night-counts, not fixed enrollment windows, and there's no
// separate "dosing day" field. So "confinement window" here means a
// *schedulable* span (its length is inpatient_nights, since dosing happens
// during inpatient confinement) rather than a fixed calendar range: any two
// studies can always be scheduled back-to-back by simply choosing when each
// one starts. This module's job is to (a) pick which studies to combine and
// (b) prove a concrete, valid, non-overlapping, washout-respecting SEQUENCE
// exists for that combination — by literally computing day offsets
// (buildSchedule) rather than just asserting a rule was checked.

import type { ScoredStudy } from "./types";

/** Regulatory floor for the gap between one study's last dosing day and the
 * next study's first dosing day. Enforced even if a study's own
 * `washout_days` is missing or (oddly) lower than this — per acceptance
 * criteria: "a minimum ~30-day washout gap ... database-enforced
 * cross-company [...] not a courtesy buffer." */
export const DEFAULT_WASHOUT_DAYS = 30;

/** Bound the combinatorics — risk mitigation from core-ui-stack-suggester.yaml:
 * "Seed data is small (a few dozen studies at most); a straightforward
 * greedy-or-bounded-search approach is sufficient for v1 — no need for
 * sophisticated optimization now." Candidates are pre-sorted by net_cash
 * descending before the pool cutoff, so the highest-value studies are never
 * the ones dropped. */
export const MAX_COMBINATION_SIZE = 5;
export const CANDIDATE_POOL_SIZE = 18;

export interface StackLeg {
  study: ScoredStudy;
  /** Day offset (0 = combination start) this leg's confinement begins. */
  start_day: number;
  /** Day offset this leg's confinement ends (inclusive). */
  end_day: number;
  /** Washout gap enforced after this leg before the next leg may start
   * dosing; 0 for the last leg (nothing to wait for afterward). */
  washout_after_days: number;
}

export interface StackSchedule {
  /** In suggested chronological order. */
  legs: StackLeg[];
  total_net_cash: number;
  /** Sum of every leg's confinement span + every inter-leg washout gap —
   * the actual calendar life committed to clear the target. */
  total_downtime_days: number;
  /** Day the last leg's confinement ends + 1 (i.e. total elapsed days). */
  total_calendar_days: number;
}

export interface StackSuggestion {
  target: number;
  found: boolean;
  schedule: StackSchedule | null;
  /** Set when found === false — an explicit, non-misleading explanation. */
  reason?: string;
  /** Informational even when found === false: what the best subset (within
   * the bounded search) could combine to, so "no" isn't just a dead end. */
  best_achievable_net_cash?: number;
}

function effectiveWashoutDays(s: ScoredStudy): number {
  return Math.max(s.washout_days ?? DEFAULT_WASHOUT_DAYS, DEFAULT_WASHOUT_DAYS);
}

function confinementSpanDays(s: ScoredStudy): number {
  return Math.max(s.inpatient_nights ?? 1, 1);
}

/**
 * Build a concrete, non-overlapping, washout-respecting schedule for a set
 * of studies.
 *
 * Total downtime is order-independent: every leg except the last pays its
 * own washout gap once, regardless of ordering among the non-last legs
 * (total washout tax = sum(washout for all legs) - max(washout among legs)).
 * So legs are ordered by ascending effective washout — putting the
 * largest-washout study last minimizes the displayed schedule's total span
 * by construction (the last leg's washout is never paid).
 */
function buildSchedule(studies: ScoredStudy[]): StackSchedule {
  const ordered = [...studies].sort(
    (a, b) => effectiveWashoutDays(a) - effectiveWashoutDays(b)
  );

  let cursor = 0;
  const legs: StackLeg[] = ordered.map((study, i) => {
    const span = confinementSpanDays(study);
    const start_day = cursor;
    const end_day = start_day + span - 1;
    const isLast = i === ordered.length - 1;
    const washout_after_days = isLast ? 0 : effectiveWashoutDays(study);
    cursor = end_day + 1 + washout_after_days;
    return { study, start_day, end_day, washout_after_days };
  });

  const total_net_cash = legs.reduce((sum, l) => sum + l.study.net_cash, 0);
  const total_downtime_days = legs.reduce(
    (sum, l) => sum + confinementSpanDays(l.study) + l.washout_after_days,
    0
  );
  const total_calendar_days = legs[legs.length - 1].end_day + 1;

  return { legs, total_net_cash, total_downtime_days, total_calendar_days };
}

function* combinations<T>(items: T[], size: number): Generator<T[]> {
  if (size === 0) {
    yield [];
    return;
  }
  if (size > items.length) return;
  for (let i = 0; i <= items.length - size; i++) {
    for (const tail of combinations(items.slice(i + 1), size - 1)) {
      yield [items[i], ...tail];
    }
  }
}

/**
 * Suggest the lowest-total-downtime combination of `studies` whose combined
 * net_cash meets or exceeds `targetCash`, respecting:
 *
 *  - no two studies scheduled with overlapping confinement windows (true by
 *    construction — buildSchedule only ever produces sequential,
 *    non-overlapping legs; overlap is never possible in the returned
 *    schedule)
 *  - a database-enforced >= ~30-day washout gap between consecutive
 *    studies' dosing (also true by construction — floored at
 *    DEFAULT_WASHOUT_DAYS regardless of a study's own washout_days value)
 *
 * `studies` should already be the caller's ELIGIBLE list (e.g. scoreAll's
 * `eligible` array) — this function does not re-run the eligibility gate,
 * matching the ranked-table/profile-panel split of responsibilities.
 *
 * Applying to multiple studies in parallel is unaffected by any of this —
 * only DOSING/confinement scheduling needs the gap. See
 * components/stack-suggester-panel.tsx for that UI copy.
 */
export function suggestStack(
  studies: ScoredStudy[],
  targetCash: number
): StackSuggestion {
  const positive = studies.filter((s) => s.net_cash > 0);

  if (positive.length === 0) {
    return {
      target: targetCash,
      found: false,
      schedule: null,
      reason: "No eligible studies with positive net cash to combine.",
      best_achievable_net_cash: 0,
    };
  }

  const byNet = [...positive].sort((a, b) => b.net_cash - a.net_cash);
  const pool = byNet.slice(0, CANDIDATE_POOL_SIZE);
  const maxSize = Math.min(MAX_COMBINATION_SIZE, pool.length);

  let best: StackSchedule | null = null;
  for (let size = 1; size <= maxSize; size++) {
    for (const combo of combinations(pool, size)) {
      const totalNet = combo.reduce((sum, s) => sum + s.net_cash, 0);
      if (totalNet < targetCash) continue; // clears the target — a candidate
      const schedule = buildSchedule(combo);
      if (
        !best ||
        schedule.total_downtime_days < best.total_downtime_days ||
        (schedule.total_downtime_days === best.total_downtime_days &&
          schedule.legs.length < best.legs.length)
      ) {
        best = schedule;
      }
    }
  }

  if (best) {
    return { target: targetCash, found: true, schedule: best };
  }

  const bestAchievable = byNet
    .slice(0, MAX_COMBINATION_SIZE)
    .reduce((sum, s) => sum + s.net_cash, 0);

  return {
    target: targetCash,
    found: false,
    schedule: null,
    reason:
      `No combination of up to ${MAX_COMBINATION_SIZE} eligible studies clears ` +
      `$${Math.round(targetCash).toLocaleString()} — the highest combined net cash ` +
      `achievable right now is about $${Math.round(bestAchievable).toLocaleString()}.`,
    best_achievable_net_cash: bestAchievable,
  };
}
