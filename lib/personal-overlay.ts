// Personal call-log write-back overlay (story: call-log-writeback).
//
// docs/APPLICATION-TRACKING.md: "The call-log write-back... closes the
// `payout timing unknown` / `nights unknown` flags in the seed... this is
// the loop: rank -> apply -> chase -> capture -> re-rank."
//
// Framework-free, mirroring lib/community-overlay.ts's own header discipline
// (no React/Next.js imports, no localStorage/DOM access -- this module never
// touches the browser). Structurally SEPARATE from lib/community-overlay.ts,
// on purpose (this story's risk register: "Conflating the personal override
// with the community-corrections overlay could cause one visitor's private
// call notes to leak into the shared consensus data"):
//   - lib/community-overlay.ts *annotates* Study/ScoredStudy rows with a
//     read-only `.community` map (display-only, never mutates the values
//     scoring.ts sees) sourced from data/community-corrections.json --
//     anonymous, unverified-until-2-independent-reports-agree data from ANY
//     visitor.
//   - THIS module does the opposite: it *overrides* the actual Study field
//     values fed INTO lib/scoring.ts's scoreAll(), sourced ONLY from THIS
//     visitor's own localStorage-only Application.call_log captures (docs:
//     "verified_by: phone-confirmed" -- a visitor's own confirmed call, not
//     an anonymous community report).
// The two modules never import from each other's merge/overlay functions
// and never share a storage key. The only intentional connection point is a
// type-only import of CorrectionFieldId below, used purely to describe which
// of a visitor's own confirmed values are ALSO eligible to be opted into the
// community pipeline via the existing /api/submit-correction route
// (shareableCallLogFields) -- that is the one, explicit, opt-in bridge this
// story's acceptance criteria calls for; nothing here ever calls
// mergeCommunityOverlay or writes data/community-corrections.json directly.
//
// lib/scoring.ts itself stays completely unmodified: applyPersonalOverlay
// only changes the Study[] *input* array passed to scoreAll() (see
// app/page.tsx), never scoring.ts's logic. Given a real confirmed
// nights/payout figure, scoring.ts's own existing "was this estimated?"
// checks (`!stays || stays.length === 0`, `!s.payout.settle_days`) naturally
// stop firing on their own -- nights_estimated/payout_unconfirmed flip to
// false and the "nights unknown"/"payout timing unknown" flags disappear,
// with NO new flag-suppression logic needed here or in scoring.ts.
//
// Every example/placeholder value anywhere in this file (and its tests) is
// generic -- never real personal data (see this story's PII acceptance
// criterion).

import type { Application, CallEntry, PayoutType, Study } from "./types";
import type { CorrectionFieldId } from "./community-overlay";

// ---- Study overlay: confirmed call-log data -> the Study fed into scoreAll ----

// A wide-open "does not block this visitor" BMI band -- NOT a fabricated
// real numeric range. `confirmed.bmi_ok` is a yes/no answer to "does my BMI
// fit?", never a reported min/max, so there is no real range to write back.
// lib/scoring.ts's own "confirm BMI on call" flag fires only when BOTH
// bmi_min and bmi_max are null (its one signal for "totally unknown"), and
// isEligible()'s bmi_min/bmi_max checks are no-ops whenever either bound is
// null (null already means "no restriction", the most-permissive state).
// Setting both bounds to this full-domain band changes nothing about
// eligibility math (a real profile BMI always satisfies 1 <= bmi <= 100)
// while correctly flipping "unknown, ask" to "confirmed, not blocking" for
// this one visitor. 100 mirrors the same domain ceiling
// lib/community-overlay.ts's normalizeCorrectionValue already enforces for
// BMI input ("max > 100" is rejected there too) -- not a new constant.
const BMI_CONFIRMED_NOT_BLOCKING_MIN = 1;
const BMI_CONFIRMED_NOT_BLOCKING_MAX = 100;

/**
 * Applies one visitor's own confirmed call-log data (lib/application-store.ts's
 * `{ study_id: Application }` map) onto the base Study[] BEFORE it is handed
 * to scoreAll() -- never mutates the input array/objects (returns new Study
 * objects), and only touches fields this visitor has actually confirmed on a
 * call. A study with no Application, or an Application with no confirmed
 * data yet, is an exact passthrough for every field -- a visitor who never
 * logs a call sees zero behavior change.
 *
 * Pure function, no localStorage/network access of its own -- app/page.tsx
 * owns loading `applications` (via lib/application-store.ts's
 * loadApplications()) and calling this before scoreAll().
 */
export function applyPersonalOverlay(
  studies: readonly Study[],
  applications: Record<string, Application> | null | undefined,
): Study[] {
  if (!applications) return studies.map((s) => ({ ...s }));
  return studies.map((s) => overlayOne(s, applications[s.id]));
}

function overlayOne(study: Study, application: Application | undefined): Study {
  if (!application) return { ...study };
  const out: Study = { ...study };

  // 1. Exact nights + stay count -> Study.stays (engine: inpatient_nights,
  // downtime, feasibility -- clears "nights unknown — confirm on call").
  const nights = application.confirmed?.nights;
  if (Array.isArray(nights) && nights.length > 0) {
    out.stays = [...nights];
  }

  // 2. Payout type + timing -> Study.payout (engine: cash_velocity via
  // settle_days -- clears "payout timing unknown — ASK how/when they pay").
  const payout = application.payout;
  if (payout && payout.settle_days != null) {
    out.payout = {
      type: payout.type,
      settle_days: payout.settle_days,
      ...(payout.note ? { note: payout.note } : {}),
    };
  }

  // 3. Washout days -> Study.washout_days (feeds the stack planner --
  // lib/stack-suggester.ts -- no scoring.ts flag exists for this today).
  if (application.washout_days !== undefined) {
    out.washout_days = application.washout_days;
  }

  // 4b. Stipend per visit -> Study.travel_stipend_per_visit (engine: reduces
  // travel_cost the same way the seed's own stipend field already does).
  if (application.stipend_per_visit != null) {
    out.travel_stipend_per_visit = application.stipend_per_visit;
  }

  // 4a. BMI fit confirmed yes, base range fully unknown -> clear "confirm
  // BMI on call" (see BMI_CONFIRMED_NOT_BLOCKING_* comment above). Never
  // overrides a range the seed already has an opinion about.
  if (application.confirmed?.bmi_ok === true && study.bmi_min == null && study.bmi_max == null) {
    out.bmi_min = BMI_CONFIRMED_NOT_BLOCKING_MIN;
    out.bmi_max = BMI_CONFIRMED_NOT_BLOCKING_MAX;
  }

  return out;
}

// ---- Call-log capture: the 5 questions -> an Application update ----------

// docs/APPLICATION-TRACKING.md "Call-log capture — the 5 questions":
//   1. Exact nights + how many separate stays
//   2. How & when do you pay (lump vs per-visit; end-of-confinement vs
//      after-last-visit; days-to-hit)
//   3. Washout (days after last dose before dosing again)
//   4. BMI range fits
//   5. Travel/lodging stipend
// Typed, already-parsed answers -- components/call-log-form.tsx is
// responsible for turning raw `<input>` strings into this shape via
// parseCallLogFormInputs below, so the numeric-parsing/validation rules live
// in one pure, unit-testable place rather than inline in JSX event handlers.
export interface CallLogAnswers {
  date: string; // ISO date the call happened
  who: string; // a role/description ("clinic coordinator") -- never a real name
  summary: string;
  totalNights?: number; // question 1a
  stayCount?: number; // question 1b -- defaults to 1 if unset when totalNights is answered
  payoutType?: PayoutType; // question 2
  settleDays?: number; // question 2
  payoutNote?: string; // question 2 -- free-text detail, e.g. "after last visit, ACH"
  washoutDays?: number | null; // question 3
  bmiOk?: boolean; // question 4
  stipendPerVisit?: number | null; // question 5
}

/**
 * Splits a visitor-reported total nights figure evenly across their reported
 * stay count -- ConfirmedOnCall.nights (like Study.stays) is nights-per-stay,
 * but a phone call only ever produces one total + one stay count (mirrors
 * lib/community-overlay.ts's own note: "visitors report one total nights
 * figure, not a per-stay breakdown"). The remainder (if total doesn't divide
 * evenly) is distributed to the first stays rather than dropped, so the sum
 * of the result always equals the reported total exactly.
 */
export function distributeNights(totalNights: number, stayCount: number): number[] {
  const count = Math.max(1, Math.round(stayCount) || 1);
  const total = Math.max(0, Math.round(totalNights));
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Merges a call's answers onto the current Application: appends one
 * CallEntry to call_log, and populates confirmed/payout/washout_days/
 * stipend_per_visit for whichever of the 5 questions were actually
 * answered -- an unanswered question leaves that field untouched (never
 * clobbers an earlier call's confirmed value with "no answer this time").
 * Never mutates `current` -- returns a new Application. Pure function --
 * components/call-log-form.tsx is responsible for persisting the result via
 * lib/application-store.ts's upsertApplication.
 */
export function buildCallLogUpdate(current: Application, answers: CallLogAnswers): Application {
  const entry: CallEntry = { date: answers.date, who: answers.who, summary: answers.summary };
  const next: Application = {
    ...current,
    call_log: [...current.call_log, entry],
    confirmed: { ...current.confirmed },
  };

  if (answers.totalNights != null && answers.totalNights >= 0) {
    const stayCount = answers.stayCount && answers.stayCount > 0 ? answers.stayCount : 1;
    next.confirmed = { ...next.confirmed, nights: distributeNights(answers.totalNights, stayCount) };
  }

  if (answers.bmiOk !== undefined) {
    next.confirmed = { ...next.confirmed, bmi_ok: answers.bmiOk };
  }

  if (answers.payoutType && answers.settleDays != null && answers.settleDays >= 0) {
    next.payout = {
      type: answers.payoutType,
      settle_days: answers.settleDays,
      ...(answers.payoutNote?.trim() ? { note: answers.payoutNote.trim() } : {}),
    };
  }

  if (answers.washoutDays !== undefined) {
    next.washout_days = answers.washoutDays;
  }

  if (answers.stipendPerVisit !== undefined) {
    next.stipend_per_visit = answers.stipendPerVisit;
  }

  return next;
}

// ---- Raw form input -> typed answers --------------------------------------

// The exact string state components/call-log-form.tsx's `<input>`s hold --
// "" means "this question wasn't answered this call", matching
// CallLogAnswers' optional fields above. Kept as a plain string-keyed shape
// (not React state itself) so parseCallLogFormInputs is testable with a
// plain object literal, no rendering required.
export interface CallLogFormInputs {
  date: string;
  who: string;
  summary: string;
  totalNights: string;
  stayCount: string;
  payoutType: PayoutType;
  settleDays: string;
  payoutNote: string;
  washoutDays: string;
  bmiOk: "unset" | "yes" | "no";
  stipendPerVisit: string;
}

function parsedNonNegativeNumber(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Turns raw `<input>` string state into CallLogAnswers -- blank/invalid
 * numeric fields are treated as "not answered" (skipped) rather than
 * throwing or coercing to 0, so a partially-filled call-log entry never
 * silently zeroes out a field the visitor just didn't get to on this call.
 */
export function parseCallLogFormInputs(inputs: CallLogFormInputs): CallLogAnswers {
  const answers: CallLogAnswers = {
    date: inputs.date,
    who: inputs.who.trim(),
    summary: inputs.summary.trim(),
  };

  const totalNights = parsedNonNegativeNumber(inputs.totalNights);
  if (totalNights !== undefined) {
    answers.totalNights = totalNights;
    const stayCount = parsedNonNegativeNumber(inputs.stayCount);
    answers.stayCount = stayCount && stayCount > 0 ? stayCount : 1;
  }

  const settleDays = parsedNonNegativeNumber(inputs.settleDays);
  if (settleDays !== undefined) {
    answers.payoutType = inputs.payoutType;
    answers.settleDays = settleDays;
    if (inputs.payoutNote.trim()) answers.payoutNote = inputs.payoutNote.trim();
  }

  if (inputs.washoutDays.trim()) {
    const w = parsedNonNegativeNumber(inputs.washoutDays);
    if (w !== undefined) answers.washoutDays = w;
  }

  if (inputs.bmiOk !== "unset") {
    answers.bmiOk = inputs.bmiOk === "yes";
  }

  const stipend = parsedNonNegativeNumber(inputs.stipendPerVisit);
  if (stipend !== undefined) answers.stipendPerVisit = stipend;

  return answers;
}

// ---- Opt-in community-correction bridge (AC5) -----------------------------

export interface ShareableField {
  field: CorrectionFieldId;
  value: string; // already canonical -- safe to pass straight to /api/submit-correction
  label: string;
}

/**
 * Which of THIS visitor's own just-confirmed values are also eligible to be
 * shared into the existing community-corrections pipeline, and the exact
 * (field, value) pair the opt-in "share with everyone" action should POST to
 * /api/submit-correction (community-corrections-consensus's existing route --
 * see app/api/submit-correction/route.ts). Never called automatically --
 * components/call-log-form.tsx only calls the API when a visitor explicitly
 * clicks a share button for one of these rows (AC5: "not automatic").
 *
 * Deliberately narrower than the 5 call-log questions: only nights and
 * payout timing have a matching CorrectionFieldId in
 * lib/community-overlay.ts's CORRECTION_FIELDS today (washout, BMI-fit, and
 * stipend have no community-corrections field to bridge into) -- this
 * reuses that EXISTING field taxonomy rather than inventing new ones, per
 * this story's "reuse that infrastructure, do not build a parallel
 * submission mechanism" requirement.
 */
export function shareableCallLogFields(application: Application): ShareableField[] {
  const out: ShareableField[] = [];

  const nights = application.confirmed?.nights;
  if (Array.isArray(nights) && nights.length > 0) {
    const total = nights.reduce((sum, n) => sum + n, 0);
    out.push({ field: "stays", value: String(total), label: "confirmed nights" });
  }

  if (application.payout?.settle_days != null) {
    out.push({
      field: "payout.settle_days",
      value: String(application.payout.settle_days),
      label: "confirmed payout timing",
    });
  }

  return out;
}
