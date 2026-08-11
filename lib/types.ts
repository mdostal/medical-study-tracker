// Schema for medical-study-tracker. Keep framework-free.

export type Currency = "USD" | "CAD";
export type PayoutType = "lump_end" | "prorated" | "milestone" | "unknown";
export type Sex = "M/F" | "male" | "female";
export type Smoker = "non" | "any" | "smoker-only";
export type Feasibility = "EASY" | "MODERATE" | "HARD" | "BLOCKED";

export interface Payout {
  type: PayoutType;
  settle_days: number | null; // days from enrollment start until ALL cash is in hand
  note?: string;
}

export interface Study {
  id: string;
  network: string;
  city: string;
  state: string;
  country?: string;        // default US
  hub: string;             // hub code, see friend map
  pay_gross: number;
  currency: Currency;
  payout: Payout;
  stays: number[] | null;  // nights per confinement stay; null = unknown (confirm on call)
  visits: number | null;   // in-person follow-up visits (each = a travel trip)
  phone_calls?: number;
  followup_weeks?: number | null; // calendar length of the follow-up tail, if known
  bmi_min: number | null;
  bmi_max: number | null;
  age_min: number;
  age_max: number;
  sex: Sex;
  smoker: Smoker;
  special_pop: string | null; // e.g. overweight_obese, asian_descent_required, high_cholesterol_required
  washout_days?: number | null; // days from last dose until eligible to dose in the next study (standard ~30; per-study, phone-only). Drives stacking — enforced across companies via VCT/CTSdatabase.
  min_weight_lb?: number;
  travel_stipend_per_visit?: number;
  eligible?: boolean;      // precomputed in seed for clearly-blocked studies
  exclude_reason?: string;
  status?: string;         // enrolling | upcoming | closed | verify
  // A real, resolving, per-STUDY detail page — the actual study's own page, not a search page or
  // a network homepage (docs/DATA-INTEGRITY.md Rule 1). Leave unset when no such page exists;
  // never fill it with a generic/listing URL "close enough" to stand in for one (story:
  // fix-study-deep-links — that exact substitution is what sent a real user to a network homepage
  // instead of their study). components/ranked-table.tsx only ever hyperlinks the study id/row
  // when this is set.
  source_url?: string;
  apply_url?: string;
  // The network's own general/homepage or search-listing page — shown ONLY as a plainly-labeled
  // "network info" pointer alongside a "call to apply" treatment when source_url is unset (a
  // network that's genuinely phone-only or register-gated, with no per-study page to link to).
  // Never used as a stand-in for source_url — see that field's own comment.
  network_url?: string;
  phone?: string;
  verified?: string;
  notes?: string;
  // True only for a study the visitor added themselves via "add study by
  // URL" (story: add-study-by-url) — never set on seed data. Drives the
  // "unverified/user-added" visual distinction in the ranked table (that
  // story's AC4) and lets lib/profile-store.ts's user-studies list be told
  // apart from data/studies.seed.json's rows without a separate array
  // living in every consumer.
  user_added?: boolean;
}

// --- Application / chase-tracking record ------------------------------------
//
// docs/APPLICATION-TRACKING.md "Data model" + "Lifecycle / status pipeline"
// sections — this type set is intentionally separate from the pre-existing,
// simpler StudyStatus in lib/local-status-store.ts (a different, older
// per-study status pill, left as-is; not this feature). One Application
// record exists per (visitor, study) — captured only in this visitor's own
// browser via lib/application-store.ts, never sent to a server. Every
// example value anywhere in this file/its tests is a generic placeholder —
// never real personal data (see this story's PII acceptance criterion).

// How this application reaches a screening — each channel has a different
// chase + confirmation path (docs/APPLICATION-TRACKING.md "Core truths").
export type ApplicationChannel =
  | "self_book" // visitor books their own screening slot directly, no waiting
  | "call" // must call the clinic to push/schedule
  | "apply_form_fillout" // a Fillout-style form; sends no confirmation email
  | "syndicated_external"; // applied on another site entirely

const APPLICATION_CHANNELS: readonly ApplicationChannel[] = [
  "self_book",
  "call",
  "apply_form_fillout",
  "syndicated_external",
];

// The funnel pipeline, per docs/APPLICATION-TRACKING.md:
//   identified -> applied|booked -> phone-screen -> screening-scheduled ->
//   screened -> qualified/offered -> enrolled -> dosing -> PAID
// plus terminal off-ramps reachable from any point in the pipeline.
export type LifecycleStatus =
  | "identified"
  | "applied"
  | "booked"
  | "phone-screen"
  | "screening-scheduled"
  | "screened"
  | "qualified"
  | "offered"
  | "enrolled"
  | "dosing"
  | "paid"
  | "not-eligible"
  | "declined"
  | "cohort-full"
  | "closed";

// The pipeline above, encoded stage-by-stage — each inner array is one
// stage; more than one entry means alternate statuses for that stage
// (channel-dependent, e.g. applied|booked), not a further sub-split. Matches
// docs/APPLICATION-TRACKING.md's arrow diagram exactly.
export const LIFECYCLE_PIPELINE: readonly (readonly LifecycleStatus[])[] = [
  ["identified"],
  ["applied", "booked"],
  ["phone-screen"],
  ["screening-scheduled"],
  ["screened"],
  ["qualified", "offered"],
  ["enrolled"],
  ["dosing"],
  ["paid"],
];

// Off-ramps reachable from ANY point in the pipeline above (docs: "terminal
// off-ramps at any point"). This module deliberately does not enforce a
// transition graph/state machine — `Application.status` type-checks as any
// LifecycleStatus regardless of the previous value — which is exactly how
// "reachable from any point" is satisfied at the data layer; a future UI
// story can layer stricter transition rules on top without changing this
// type.
export const TERMINAL_LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
  "not-eligible",
  "declined",
  "cohort-full",
  "closed",
];

const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
  ...LIFECYCLE_PIPELINE.flat(),
  ...TERMINAL_LIFECYCLE_STATUSES,
];

// "Whose move is it" — separate from LifecycleStatus (which stage of the
// funnel this is who needs to act next within that stage).
export type ChaseState = "on_me" | "waiting" | "stale" | "done";

const CHASE_STATES: readonly ChaseState[] = ["on_me", "waiting", "stale", "done"];

export type Urgency = "now" | "this_week" | "normal";

const URGENCIES: readonly Urgency[] = ["now", "this_week", "normal"];

// One phone call/screening interaction, logged chronologically. `who` is a
// role/description (e.g. "clinic coordinator"), never expected to hold a
// real person's name.
export interface CallEntry {
  date: string;
  who: string;
  summary: string;
}

// Whether this application actually landed anywhere. Fillout/syndicated
// channels send no confirmation email (docs "The no-email-confirmation gap
// is real"), so this has to be tracked by hand rather than inferred.
export interface ApplicationConfirmation {
  has_number: boolean;
  confirmed_in_system: boolean;
  no_email_flag: boolean;
  ref?: string;
}

// `tz` drives the "callable now" business-hours check (docs "Recruiting
// runs business hours").
export interface ApplicationContact {
  phone?: string;
  scheduler_url?: string;
  tz?: string;
}

// The call-log write-back capture (docs "Call-log capture — the 5
// questions"). Populated on the screening call; a later story feeds these
// into lib/scoring.ts to replace estimated values with confirmed ones.
export interface ConfirmedOnCall {
  nights?: number[];
  visits?: number;
  bmi_ok?: boolean;
}

export interface Application {
  study_id: string;
  channel: ApplicationChannel;
  status: LifecycleStatus;
  chase_state: ChaseState;
  applied_date?: string;
  confirmation: ApplicationConfirmation;
  contact: ApplicationContact;
  next_action?: string; // e.g. "self-book screening" | "call to push" | "await cohort dates"
  next_action_due?: string; // cohort deadline / follow-up-by date -> drives nudges
  urgency?: Urgency;
  call_log: CallEntry[];
  // Captured on the screening call — write back onto the Study + engine
  // (docs "these WRITE BACK into the Study + engine"). This story only
  // stores them; the write-back itself is a later story.
  screening_date?: string;
  cohort_dates?: string[];
  confirmed: ConfirmedOnCall;
  payout?: Payout; // feeds cash_velocity
  washout_days?: number | null; // feeds the stack planner
  stipend_per_visit?: number | null;
  notes?: string;
}

export const DEFAULT_APPLICATION_CHANNEL: ApplicationChannel = "apply_form_fillout";
export const DEFAULT_LIFECYCLE_STATUS: LifecycleStatus = "identified";
export const DEFAULT_CHASE_STATE: ChaseState = "on_me";

function isApplicationChannel(value: unknown): value is ApplicationChannel {
  return typeof value === "string" && (APPLICATION_CHANNELS as readonly string[]).includes(value);
}

function isLifecycleStatus(value: unknown): value is LifecycleStatus {
  return typeof value === "string" && (LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

function isChaseState(value: unknown): value is ChaseState {
  return typeof value === "string" && (CHASE_STATES as readonly string[]).includes(value);
}

function isUrgency(value: unknown): value is Urgency {
  return typeof value === "string" && (URGENCIES as readonly string[]).includes(value);
}

const DEFAULT_APPLICATION_CONFIRMATION: ApplicationConfirmation = {
  has_number: false,
  confirmed_in_system: false,
  no_email_flag: false,
};

function sanitizeConfirmation(value: unknown): ApplicationConfirmation {
  const src = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const out: ApplicationConfirmation = {
    has_number: bool(src.has_number, DEFAULT_APPLICATION_CONFIRMATION.has_number),
    confirmed_in_system: bool(
      src.confirmed_in_system,
      DEFAULT_APPLICATION_CONFIRMATION.confirmed_in_system,
    ),
    no_email_flag: bool(src.no_email_flag, DEFAULT_APPLICATION_CONFIRMATION.no_email_flag),
  };
  if (typeof src.ref === "string") out.ref = src.ref;
  return out;
}

function sanitizeContact(value: unknown): ApplicationContact {
  const src = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out: ApplicationContact = {};
  if (typeof src.phone === "string") out.phone = src.phone;
  if (typeof src.scheduler_url === "string") out.scheduler_url = src.scheduler_url;
  if (typeof src.tz === "string") out.tz = src.tz;
  return out;
}

function isCallEntry(value: unknown): value is CallEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.date === "string" && typeof v.who === "string" && typeof v.summary === "string";
}

function sanitizeCallLog(value: unknown): CallEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isCallEntry).map((entry) => ({
    date: entry.date,
    who: entry.who,
    summary: entry.summary,
  }));
}

function sanitizeConfirmedOnCall(value: unknown): ConfirmedOnCall {
  const src = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out: ConfirmedOnCall = {};
  if (
    Array.isArray(src.nights) &&
    src.nights.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    out.nights = src.nights as number[];
  }
  if (typeof src.visits === "number" && Number.isFinite(src.visits)) out.visits = src.visits;
  if (typeof src.bmi_ok === "boolean") out.bmi_ok = src.bmi_ok;
  return out;
}

const PAYOUT_TYPES: readonly PayoutType[] = ["lump_end", "prorated", "milestone", "unknown"];

function isPayoutType(value: unknown): value is PayoutType {
  return typeof value === "string" && (PAYOUT_TYPES as readonly string[]).includes(value);
}

function sanitizeApplicationPayout(value: unknown): Payout | undefined {
  if (!value || typeof value !== "object") return undefined;
  const src = value as Record<string, unknown>;
  if (!isPayoutType(src.type)) return undefined;
  const settle_days =
    typeof src.settle_days === "number" && Number.isFinite(src.settle_days) ? src.settle_days : null;
  const out: Payout = { type: src.type, settle_days };
  if (typeof src.note === "string") out.note = src.note;
  return out;
}

/**
 * Normalize arbitrary/untrusted input (parsed JSON from localStorage or a
 * share-link URL) into a valid Application. Never throws — anything
 * missing, malformed, or wrong-typed falls back to a default field-by-field,
 * same discipline as sanitizePersistedState below. `studyId` always wins
 * over any embedded `study_id` on the input, so a map entry can never
 * disagree with its own key (same never-trust-embedded-value discipline as
 * lib/profile-store.ts's addUserStudy forcing user_added:true).
 */
export function sanitizeApplication(value: unknown, studyId: string): Application {
  const src = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;

  const app: Application = {
    study_id: studyId,
    channel: isApplicationChannel(src.channel) ? src.channel : DEFAULT_APPLICATION_CHANNEL,
    status: isLifecycleStatus(src.status) ? src.status : DEFAULT_LIFECYCLE_STATUS,
    chase_state: isChaseState(src.chase_state) ? src.chase_state : DEFAULT_CHASE_STATE,
    confirmation: sanitizeConfirmation(src.confirmation),
    contact: sanitizeContact(src.contact),
    call_log: sanitizeCallLog(src.call_log),
    confirmed: sanitizeConfirmedOnCall(src.confirmed),
  };

  if (typeof src.applied_date === "string") app.applied_date = src.applied_date;
  if (typeof src.next_action === "string") app.next_action = src.next_action;
  if (typeof src.next_action_due === "string") app.next_action_due = src.next_action_due;
  if (isUrgency(src.urgency)) app.urgency = src.urgency;
  if (typeof src.screening_date === "string") app.screening_date = src.screening_date;
  if (
    Array.isArray(src.cohort_dates) &&
    src.cohort_dates.every((d) => typeof d === "string")
  ) {
    app.cohort_dates = src.cohort_dates as string[];
  }
  const payout = sanitizeApplicationPayout(src.payout);
  if (payout) app.payout = payout;
  if (src.washout_days === null) {
    app.washout_days = null;
  } else if (typeof src.washout_days === "number" && Number.isFinite(src.washout_days)) {
    app.washout_days = src.washout_days;
  }
  if (src.stipend_per_visit === null) {
    app.stipend_per_visit = null;
  } else if (
    typeof src.stipend_per_visit === "number" &&
    Number.isFinite(src.stipend_per_visit)
  ) {
    app.stipend_per_visit = src.stipend_per_visit;
  }
  if (typeof src.notes === "string") app.notes = src.notes;

  return app;
}

/**
 * Normalize an arbitrary/untrusted { study_id: Application } map (parsed
 * JSON from localStorage or a share-link URL) the same never-throw way
 * sanitizeApplication normalizes one record. Non-object/array input and
 * non-string/empty keys are dropped rather than trusted.
 */
export function sanitizeApplicationsMap(value: unknown): Record<string, Application> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, Application> = {};
  for (const [studyId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof studyId !== "string" || studyId.length === 0) continue;
    out[studyId] = sanitizeApplication(raw, studyId);
  }
  return out;
}

/** Builds a fresh Application record for a study, defaults everywhere else. */
export function createApplication(
  studyId: string,
  channel: ApplicationChannel = DEFAULT_APPLICATION_CHANNEL,
): Application {
  return sanitizeApplication({ channel }, studyId);
}

export interface Profile {
  bmi: number;
  weight_lb: number;
  sex: "male" | "female";
  age?: number;            // if known, checked against a study's age_min/age_max range
  smoker?: boolean;        // if known, checked against Study.smoker; undefined never blocks
  conditions?: string[];   // e.g. high cholesterol -> satisfies high_cholesterol_required
}

// The example profile every anonymous visitor sees until they edit their own
// (components/profile-panel.tsx) — a generic placeholder, never a real
// person's data. Deliberately exported as the single source of truth so
// app/page.tsx's "example profile" banner and PersistedState's default below
// can never drift from each other.
export const DEFAULT_PROFILE: Profile = {
  bmi: 22,
  weight_lb: 170,
  sex: "male",
  age: 32,
  smoker: false,
  conditions: [],
};

// A named point (city center, approximately) used to compute a real
// drive-vs-fly distance in lib/scoring.ts. Not tied to any particular city —
// any visitor's home base, or any travel hub, can be one of these.
export interface GeoPoint {
  city: string;
  lat: number;
  lng: number;
}

// story: generalize-profile-inputs — Assumptions.home_base used to be a
// literal "austin" | "omaha" union with hardcoded per-city lookup tables in
// lib/scoring.ts. It's now any city: a plain free-text name (no
// coordinates — drivable() can't compute a distance for it, so travel cost
// conservatively falls back to flight_cost) or a {city, lat, lng} shape
// (chosen from the home-base typeahead in components/profile-panel.tsx,
// backed by lib/us-cities.ts) that lets drivable() compute a real distance
// against a real threshold. `null` = no home base set at all — the tool
// still ranks/shows every eligible study nationally, it just can't tell
// drivable from fly-only without a base point, so it conservatively assumes
// every trip is a flight. No city name has any special-cased meaning
// anywhere in this type or in lib/scoring.ts.
export type HomeBase = GeoPoint | string | null;

// A hub with user-confirmed free backup-care coverage (e.g. a friend or
// family member in that metro who has actually offered to help while the
// visitor is away). NEVER guessed/inferred by this app — only ever
// populated from something the user themselves stated. See
// data/friend-childcare-map.json's own header comment for the full rule.
export interface BackupCareHub {
  note?: string;
}

export interface FriendMap {
  hubs: Record<string, GeoPoint>;
  backup_care_available: Record<string, BackupCareHub>;
}

export interface Assumptions {
  home_base: HomeBase;
  // story: generalize-profile-inputs — replaces the old always-on
  // "everyone needs childcare" assumption. Defaults to false: a single
  // visitor with no dependents pays $0 backup-care cost, unconditionally,
  // and never sees the backup-care rate/coverage UI at all.
  has_dependents_needing_care: boolean;
  // User-entered estimate of their own backup-care cost per night of
  // downtime (childcare, pet-sitting, elder care, etc.) — was a hardcoded
  // $200/night constant; now a Profile input like any other.
  backup_care_rate_per_night: number;
  flight_cost: number;
  drive_cost: number;
  friend_threshold_nights: number;
  max_away_nights: number;
  w_net: number;
  w_velocity: number;
  w_downtime: number;
  fx_cad_usd: number;
}

export interface ScoredStudy extends Study {
  pay_usd: number;
  inpatient_nights: number | null;
  nights_estimated: boolean;
  trips: number;
  drivable: boolean;
  travel_cost: number;
  backup_care_cost: number;
  // story: configurable-backup-care-coverage — "free-coverage" means ONLY
  // "this hub is in the visitor's own persisted backup_care_hubs" (never a
  // default, never inferred). "short-stay-no-cost" is the DIFFERENT reason
  // a stay can also cost $0: it's short enough for friend_threshold_nights
  // to cover regardless of location/hub. These were previously conflated
  // under "free-coverage", which meant a fresh visitor with zero configured
  // hubs could still see a "free coverage" badge on a short-stay study —
  // exactly the kind of misleading-badge bug this story exists to prevent.
  backup_care_by: "paid-backup-care" | "free-coverage" | "short-stay-no-cost" | "no-dependents";
  net_cash: number;
  settle_days: number;
  payout_unconfirmed: boolean;
  cash_velocity: number;   // net $ per 30 days until paid
  downtime_days: number;
  downtime_rate: number;   // net $ per day of life committed
  eff_per_night: number | null;
  feasibility: Feasibility;
  score: number;           // 0-100 composite (0 if blocked)
  flags: string[];         // e.g. "confirm BMI", "age cap 40", "nights unknown"
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  home_base: null,
  has_dependents_needing_care: false,
  backup_care_rate_per_night: 200,
  flight_cost: 350,
  drive_cost: 70,
  friend_threshold_nights: 3,
  max_away_nights: 31,
  w_net: 0.35,
  w_velocity: 0.45,
  w_downtime: 0.20,
  fx_cad_usd: 0.73,
};

// --- Persisted/shareable state ---------------------------------------------
//
// "Profile" is the product term for a visitor's tunable inputs — see
// design-discussion.md §7 V1: "'Profile' is now the canonical term;
// 'assumptions panel' is only the UI name for editing it." In code that
// tunable object is the `Assumptions` type above (kept as-is rather than
// renamed, since lib/scoring.ts's signature already depends on it). SortKey
// is the other bit of view state a "share this view" link needs to carry so
// the reproduced view actually matches what was shared, not just the inputs.
//
// PersistedState, its default, and sanitizePersistedState are the shared
// contract between lib/profile-store.ts (localStorage adapter) and
// lib/share-link.ts (URL encode/decode) — both restore-paths (reload vs.
// opening a share link) fall back to the exact same defaults the exact same
// way. This stays here, not in either adapter, so scoring.ts/types.ts remain
// the framework-free foundation both adapters build on — sanitizePersistedState
// itself touches no browser API, it's a pure object validator.

export type SortKey =
  | "score"
  | "net_cash"
  | "cash_velocity"
  | "downtime_rate"
  | "pay_gross";

const SORT_KEYS: readonly SortKey[] = [
  "score",
  "net_cash",
  "cash_velocity",
  "downtime_rate",
  "pay_gross",
];

export const DEFAULT_SORT_KEY: SortKey = "score";

export interface PersistedState {
  // This visitor's own medical/eligibility inputs (BMI, weight, sex, age,
  // smoker) -- previously hardcoded to DEFAULT_PROFILE everywhere and never
  // editable or persisted, which meant eligibility (bmi_min/max, sex-only,
  // smoker-only studies) was computed against the SAME fictional example
  // profile for every visitor regardless of their real BMI/sex/smoker status
  // (story: editable-profile). Defaults to DEFAULT_PROFILE, same
  // restore-from-localStorage-or-share-link path as Assumptions below.
  profile: Profile;
  assumptions: Assumptions;
  sortKey: SortKey;
  // story: configurable-backup-care-coverage — hub codes (data/friend-childcare-map.json's
  // `hubs` keys, e.g. "AUS") where THIS visitor has stated they personally
  // have free backup-care coverage (their own friend/family/partner, not a
  // fact about the clinic or city). Defaults to empty: a fresh visitor sees
  // NO free coverage anywhere until they explicitly add a hub themselves via
  // the Profile panel control. Never populated by anything other than the
  // visitor's own action — see data/friend-childcare-map.json's header
  // comment for the incident this replaces. Merged into FriendMap.
  // backup_care_available at render time (app/page.tsx) — the static JSON
  // file's own backup_care_available stays permanently empty.
  backup_care_hubs: string[];
}

export const DEFAULT_PERSISTED_STATE: PersistedState = {
  profile: DEFAULT_PROFILE,
  assumptions: DEFAULT_ASSUMPTIONS,
  sortKey: DEFAULT_SORT_KEY,
  backup_care_hubs: [],
};

function isSortKey(value: unknown): value is SortKey {
  return typeof value === "string" && (SORT_KEYS as readonly string[]).includes(value);
}

function isGeoPoint(v: unknown): v is GeoPoint {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.city === "string" &&
    typeof o.lat === "number" && Number.isFinite(o.lat) &&
    typeof o.lng === "number" && Number.isFinite(o.lng)
  );
}

// Any city is valid — a free string, a {city, lat, lng} shape, or null
// (no home base set). No city name gets special-cased; anything else
// (wrong type, malformed object) falls back to the default (null).
function sanitizeHomeBase(v: unknown): HomeBase {
  if (v === null || typeof v === "string") return v;
  if (isGeoPoint(v)) return { city: v.city, lat: v.lat, lng: v.lng };
  return DEFAULT_ASSUMPTIONS.home_base;
}

function isSex(value: unknown): value is Profile["sex"] {
  return value === "male" || value === "female";
}

/** Same never-throw, field-by-field-fallback discipline as sanitizeAssumptions below. */
function sanitizeProfile(input: unknown): Profile {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;

  return {
    bmi: num(src.bmi, DEFAULT_PROFILE.bmi),
    weight_lb: num(src.weight_lb, DEFAULT_PROFILE.weight_lb),
    sex: isSex(src.sex) ? src.sex : DEFAULT_PROFILE.sex,
    age: num(src.age, DEFAULT_PROFILE.age as number),
    smoker: typeof src.smoker === "boolean" ? src.smoker : DEFAULT_PROFILE.smoker,
    conditions: Array.isArray(src.conditions)
      ? src.conditions.filter((c): c is string => typeof c === "string")
      : [...(DEFAULT_PROFILE.conditions ?? [])],
  };
}

function sanitizeAssumptions(input: unknown): Assumptions {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

  return {
    home_base: sanitizeHomeBase(src.home_base),
    has_dependents_needing_care: bool(
      src.has_dependents_needing_care,
      DEFAULT_ASSUMPTIONS.has_dependents_needing_care,
    ),
    backup_care_rate_per_night: num(
      src.backup_care_rate_per_night,
      DEFAULT_ASSUMPTIONS.backup_care_rate_per_night,
    ),
    flight_cost: num(src.flight_cost, DEFAULT_ASSUMPTIONS.flight_cost),
    drive_cost: num(src.drive_cost, DEFAULT_ASSUMPTIONS.drive_cost),
    friend_threshold_nights: num(
      src.friend_threshold_nights,
      DEFAULT_ASSUMPTIONS.friend_threshold_nights,
    ),
    max_away_nights: num(src.max_away_nights, DEFAULT_ASSUMPTIONS.max_away_nights),
    w_net: num(src.w_net, DEFAULT_ASSUMPTIONS.w_net),
    w_velocity: num(src.w_velocity, DEFAULT_ASSUMPTIONS.w_velocity),
    w_downtime: num(src.w_downtime, DEFAULT_ASSUMPTIONS.w_downtime),
    fx_cad_usd: num(src.fx_cad_usd, DEFAULT_ASSUMPTIONS.fx_cad_usd),
  };
}

// story: configurable-backup-care-coverage — accepts only a flat array of
// non-empty strings; dedupes; anything else (wrong type, non-string
// entries, malformed input) falls back to the default empty list rather
// than throwing or partially-trusting the input. Hub codes that don't
// exist in data/friend-childcare-map.json's hubs are harmless no-ops at
// merge time (app/page.tsx only merges codes present in the static hubs
// list) — this validator doesn't need to know that list.
function sanitizeBackupCareHubs(v: unknown): string[] {
  if (!Array.isArray(v)) return [...DEFAULT_PERSISTED_STATE.backup_care_hubs];
  const cleaned = v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return Array.from(new Set(cleaned));
}

/**
 * Normalize arbitrary/untrusted input (parsed JSON from localStorage or a
 * share-link URL) into a valid PersistedState. Never throws — anything
 * missing, malformed, or wrong-typed falls back to defaults field-by-field,
 * per this story's "malformed share link" acceptance criterion.
 */
export function sanitizePersistedState(input: unknown): PersistedState {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    profile: sanitizeProfile(src.profile),
    assumptions: sanitizeAssumptions(src.assumptions),
    sortKey: isSortKey(src.sortKey) ? src.sortKey : DEFAULT_SORT_KEY,
    backup_care_hubs: sanitizeBackupCareHubs(src.backup_care_hubs),
  };
}
