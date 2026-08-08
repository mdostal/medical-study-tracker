// Reference implementation of docs/SCORING.md. Pure, framework-free, unit-testable.
// The hive can import this directly as the engine; the UI is a thin shell over scoreAll().

import type {
  Study, Profile, FriendMap, Assumptions, ScoredStudy, Feasibility, HomeBase, GeoPoint,
} from "./types";

const MAD_DEFAULT_NIGHTS = 21;   // fallback when a MAD study hides its night count
const STAY_DEFAULT_NIGHTS = 8;   // fallback for a null-stay non-MAD study

// story: generalize-profile-inputs — "drivable" used to be a hardcoded
// per-city hub lookup keyed on the literal strings "austin"/"omaha". It's
// now a real distance check: any home base with coordinates is drivable
// from any hub with coordinates if they're within DRIVABLE_MILES of each
// other (~250 miles, roughly a 4hr drive) — no city name is special-cased.
const DRIVABLE_MILES = 250;
const EARTH_RADIUS_MILES = 3958.8;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two lat/lng points, in miles. */
function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---- eligibility gate -------------------------------------------------------
export function isEligible(s: Study, p: Profile): { ok: boolean; reason?: string } {
  if (s.eligible === false) return { ok: false, reason: s.exclude_reason };
  if (s.status === "closed") return { ok: false, reason: "closed" };
  if (s.sex === "female" && p.sex === "male") return { ok: false, reason: "female-only" };
  if (s.special_pop === "overweight_obese") return { ok: false, reason: "requires BMI 27+" };
  if (s.special_pop === "asian_descent_required") return { ok: false, reason: "ethnobridging" };
  if (s.bmi_min != null && p.bmi < s.bmi_min) return { ok: false, reason: `BMI < ${s.bmi_min}` };
  if (s.bmi_max != null && p.bmi > s.bmi_max) return { ok: false, reason: `BMI > ${s.bmi_max}` };
  if (s.min_weight_lb != null && p.weight_lb < s.min_weight_lb) return { ok: false, reason: `weight < ${s.min_weight_lb}` };
  if (p.age != null && p.age > s.age_max) return { ok: false, reason: `age > ${s.age_max}` };
  if (s.special_pop === "high_cholesterol_required") return { ok: false, reason: "requires documented high cholesterol (he doesn't have it)" };
  return { ok: true };
}

// ---- travel helpers ----------------------------------------------------------
// No home base set at all, or a home base with no coordinates (a plain
// typed-in city name that isn't in the typeahead dataset) -> we can't
// compute a distance, so this conservatively returns false (fly), never
// true. A visitor is never blocked from seeing every study either way —
// this only affects the travel_cost estimate.
function drivable(hub: string, base: HomeBase, fm: FriendMap): boolean {
  if (!base || typeof base === "string") return false;
  const hubLocation = fm.hubs[hub];
  if (!hubLocation) return false;
  return haversineMiles(base, hubLocation) <= DRIVABLE_MILES;
}

// ---- backup-care cost --------------------------------------------------------
// story: generalize-profile-inputs — replaces the old flat "everyone needs
// $200/night of paid childcare" model. $0 unconditionally unless the visitor has told
// us (Assumptions.has_dependents_needing_care) that they have dependents
// needing coverage while away. Even then, a stay is free if it's short
// enough for a friend/family member to cover (friend_threshold_nights) OR
// the study's hub has user-stated free coverage (fm.backup_care_available)
// — never guessed. Anything else costs the user's own entered rate
// (backup_care_rate_per_night), not a hardcoded constant.
function backupCareCost(
  stays: number[], hub: string, a: Assumptions, fm: FriendMap,
): { cost: number; by: ScoredStudy["backup_care_by"] } {
  if (!a.has_dependents_needing_care) return { cost: 0, by: "no-dependents" };

  const hasFreeCoverage = Boolean(fm.backup_care_available[hub]);
  let cost = 0;
  for (const n of stays) {
    if (n <= a.friend_threshold_nights || hasFreeCoverage) continue;
    cost += n * a.backup_care_rate_per_night;
  }
  return { cost, by: cost > 0 ? "paid-backup-care" : "free-coverage" };
}

// ---- core derivation --------------------------------------------------------
export function scoreOne(
  s: Study, p: Profile, a: Assumptions, fm: FriendMap
): ScoredStudy {
  const flags: string[] = [];
  const elig = isEligible(s, p);

  const pay_usd = s.pay_gross * (s.currency === "CAD" ? a.fx_cad_usd : 1);

  // nights
  let stays = s.stays;
  let nights_estimated = false;
  if (!stays || stays.length === 0) {
    nights_estimated = true;
    flags.push("nights unknown — confirm on call");
    const n = /MAD/i.test(s.id) ? MAD_DEFAULT_NIGHTS : STAY_DEFAULT_NIGHTS;
    stays = [n];
  }
  const inpatient_nights = stays.reduce((x, y) => x + y, 0);
  const visits = s.visits ?? 0;
  const trips = stays.length + visits;

  // travel
  const isDrive = drivable(s.hub, a.home_base, fm);
  const perTrip = isDrive ? a.drive_cost : a.flight_cost;
  let travel_cost = trips * perTrip;
  if (s.travel_stipend_per_visit) travel_cost -= s.travel_stipend_per_visit * visits;
  if (travel_cost < 0) travel_cost = 0;

  // backup care (childcare, pet-sitting, elder care, etc.)
  const { cost: backup_care_cost, by: backup_care_by } = backupCareCost(stays, s.hub, a, fm);

  // payout timing
  let settle_days = s.payout.settle_days ?? 0;
  let payout_unconfirmed = false;
  if (!s.payout.settle_days) {
    payout_unconfirmed = true;
    // conservative: paid after the last visit. Assume visits ~weekly after confinement.
    settle_days = inpatient_nights + visits * 7;
    if (settle_days < 14) settle_days = 14;
    flags.push("payout timing unknown — ASK how/when they pay");
  }

  // downtime (confinement full days + discounted follow-up tail)
  const tailWeeks = s.followup_weeks ?? visits; // ~1 visit/week if unknown
  const downtime_days = inpatient_nights + tailWeeks * 7 * 0.15;

  const net_cash = pay_usd - travel_cost - backup_care_cost;
  const cash_velocity = (net_cash / Math.max(settle_days, 1)) * 30;
  const downtime_rate = net_cash / Math.max(downtime_days, 1);
  const eff_per_night = net_cash / Math.max(inpatient_nights, 1);

  // feasibility
  const maxStay = Math.max(...stays);
  let feasibility: Feasibility;
  if (!elig.ok) feasibility = "BLOCKED";
  else if (maxStay <= a.friend_threshold_nights) feasibility = "EASY";   // short = easy to cover
  else if (maxStay <= 9) feasibility = "MODERATE";
  else if (maxStay <= a.max_away_nights) feasibility = "HARD";           // long single stay
  else feasibility = "BLOCKED";                                          // longer than he can be away
  // NOTE: feasibility reflects stay LENGTH only. It does NOT judge whether the visitor has
  // backup care in a city — that's the user's call, never inferred.

  // per-study flags
  if (s.bmi_min == null && s.bmi_max == null) flags.push("confirm BMI on call");
  if (s.age_max <= 40) flags.push(`age cap ${s.age_max} — verify`);
  if (s.currency === "CAD") flags.push("CAD → confirm passport/eligibility");

  return {
    ...s,
    pay_usd, inpatient_nights, nights_estimated, trips, drivable: isDrive,
    travel_cost, backup_care_cost, backup_care_by, net_cash, settle_days, payout_unconfirmed,
    cash_velocity, downtime_days, downtime_rate, eff_per_night,
    feasibility, score: 0, flags,
  };
}

// ---- rank the whole set (composite score normalized across eligible) --------
export function scoreAll(
  studies: Study[], p: Profile, a: Assumptions, fm: FriendMap
): { eligible: ScoredStudy[]; blocked: ScoredStudy[] } {
  const wSum = a.w_net + a.w_velocity + a.w_downtime || 1;
  const wNet = a.w_net / wSum, wVel = a.w_velocity / wSum, wDt = a.w_downtime / wSum;

  const scored = studies.map((s) => scoreOne(s, p, a, fm));
  const eligible = scored.filter((s) => s.feasibility !== "BLOCKED" && isEligible(s, p).ok);
  const blocked = scored.filter((s) => !eligible.includes(s));

  const norm = (vals: number[]) => {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return (v: number) => (hi === lo ? 1 : (v - lo) / (hi - lo));
  };
  const nNet = norm(eligible.map((s) => s.net_cash));
  const nVel = norm(eligible.map((s) => s.cash_velocity));
  const nDt = norm(eligible.map((s) => s.downtime_rate));
  const mult: Record<Feasibility, number> = { EASY: 1.0, MODERATE: 0.85, HARD: 0.6, BLOCKED: 0 };

  for (const s of eligible) {
    const raw = wNet * nNet(s.net_cash) + wVel * nVel(s.cash_velocity) + wDt * nDt(s.downtime_rate);
    s.score = Math.round(100 * raw * mult[s.feasibility]);
  }
  eligible.sort((x, y) => y.score - x.score || y.cash_velocity - x.cash_velocity);
  return { eligible, blocked };
}
