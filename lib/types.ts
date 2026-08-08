// Schema for medical-study-tracker. Keep framework-free.

export type Currency = "USD" | "CAD";
export type PayoutType = "lump_end" | "prorated" | "milestone" | "unknown";
export type Sex = "M/F" | "male" | "female";
export type Smoker = "non" | "any" | "smoker-only";
export type Feasibility = "EASY" | "MODERATE" | "HARD" | "BLOCKED";
export type CanTake = "yes" | "likely" | "maybe" | "no";

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
  source_url?: string;
  apply_url?: string;
  phone?: string;
  verified?: string;
  notes?: string;
}

export interface Profile {
  bmi: number;
  weight_lb: number;
  sex: "male" | "female";
  age?: number;            // if known, used against age_max caps
  conditions?: string[];   // e.g. high cholesterol -> satisfies high_cholesterol_required
}

export interface FriendMetro {
  metro: string;
  covers_hubs: string[];
  childcare_available: CanTake;
  has_kids?: boolean | null;
  notes?: string;
}

export interface FriendMap {
  hubs: Record<string, string>;
  friend_metros: FriendMetro[];
  base_drive_hubs: Record<string, string[]>;
  home_base_childcare: Record<string, { childcare_available: CanTake; notes?: string }>;
}

export interface Assumptions {
  home_base: "austin" | "omaha";
  nanny_rate: number;
  flight_cost: number;
  drive_cost: number;
  friend_threshold_nights: number;
  max_away_nights: number;
  model_childcare: boolean; // OFF by default — childcare is the user's call, never guessed from friends
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
  childcare_cost: number;
  childcare_by: "nanny" | "user-decides";
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
  home_base: "austin",
  nanny_rate: 200,
  flight_cost: 350,
  drive_cost: 70,
  friend_threshold_nights: 3,
  max_away_nights: 31,
  model_childcare: false,
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
}

export const DEFAULT_PERSISTED_STATE: PersistedState = {
  assumptions: DEFAULT_ASSUMPTIONS,
  sortKey: DEFAULT_SORT_KEY,
};

function isSortKey(value: unknown): value is SortKey {
  return typeof value === "string" && (SORT_KEYS as readonly string[]).includes(value);
}

function sanitizeAssumptions(input: unknown): Assumptions {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const rawHomeBase = src.home_base;
  const home_base =
    rawHomeBase === "austin" || rawHomeBase === "omaha"
      ? rawHomeBase
      : DEFAULT_ASSUMPTIONS.home_base;

  return {
    home_base,
    nanny_rate: num(src.nanny_rate, DEFAULT_ASSUMPTIONS.nanny_rate),
    flight_cost: num(src.flight_cost, DEFAULT_ASSUMPTIONS.flight_cost),
    drive_cost: num(src.drive_cost, DEFAULT_ASSUMPTIONS.drive_cost),
    friend_threshold_nights: num(
      src.friend_threshold_nights,
      DEFAULT_ASSUMPTIONS.friend_threshold_nights,
    ),
    max_away_nights: num(src.max_away_nights, DEFAULT_ASSUMPTIONS.max_away_nights),
    model_childcare: bool(src.model_childcare, DEFAULT_ASSUMPTIONS.model_childcare),
    w_net: num(src.w_net, DEFAULT_ASSUMPTIONS.w_net),
    w_velocity: num(src.w_velocity, DEFAULT_ASSUMPTIONS.w_velocity),
    w_downtime: num(src.w_downtime, DEFAULT_ASSUMPTIONS.w_downtime),
    fx_cad_usd: num(src.fx_cad_usd, DEFAULT_ASSUMPTIONS.fx_cad_usd),
  };
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
  };
}
