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

export interface Profile {
  bmi: number;
  weight_lb: number;
  sex: "male" | "female";
  age?: number;            // if known, used against age_max caps
  conditions?: string[];   // e.g. high cholesterol -> satisfies high_cholesterol_required
}

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
    assumptions: sanitizeAssumptions(src.assumptions),
    sortKey: isSortKey(src.sortKey) ? src.sortKey : DEFAULT_SORT_KEY,
    backup_care_hubs: sanitizeBackupCareHubs(src.backup_care_hubs),
  };
}
