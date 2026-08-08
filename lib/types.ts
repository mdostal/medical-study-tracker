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
  can_take_riley: CanTake;
  has_kids?: boolean | null;
  notes?: string;
}

export interface FriendMap {
  hubs: Record<string, string>;
  friend_metros: FriendMetro[];
  base_drive_hubs: Record<string, string[]>;
  home_base_childcare: Record<string, { can_take_riley: CanTake; notes?: string }>;
}

export interface Assumptions {
  home_base: "austin" | "omaha";
  nanny_rate: number;
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
  childcare_cost: number;
  childcare_by: "friend" | "short-friend" | "nanny" | "mixed";
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
  w_net: 0.35,
  w_velocity: 0.45,
  w_downtime: 0.20,
  fx_cad_usd: 0.73,
};
