// Reference implementation of docs/SCORING.md. Pure, framework-free, unit-testable.
// The hive can import this directly as the engine; the UI is a thin shell over scoreAll().

import type {
  Study, Profile, FriendMap, Assumptions, ScoredStudy, Feasibility,
} from "./types";

const MAD_DEFAULT_NIGHTS = 21;   // fallback when a MAD study hides its night count
const STAY_DEFAULT_NIGHTS = 8;   // fallback for a null-stay non-MAD study

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

// ---- childcare / travel helpers --------------------------------------------
function drivable(hub: string, base: string, fm: FriendMap): boolean {
  return (fm.base_drive_hubs[base] || []).includes(hub);
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

  // childcare: NEVER guessed from any friend map — the user decides coverage per study.
  // Not modeled by default. If a.model_childcare is on, apply a flat nanny estimate for
  // stays longer than the threshold (no per-city friend assumptions of any kind).
  let childcare_cost = 0;
  let nannyNights = 0;
  if (a.model_childcare) {
    for (const n of stays) if (n > a.friend_threshold_nights) { nannyNights += n; childcare_cost += n * a.nanny_rate; }
  }
  const childcare_by: ScoredStudy["childcare_by"] = nannyNights > 0 ? "nanny" : "user-decides";

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

  const net_cash = pay_usd - travel_cost - childcare_cost;
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
  // NOTE: feasibility reflects stay LENGTH only. It does NOT judge whether he has childcare in a city —
  // that's the user's call, never inferred.

  // per-study flags
  if (s.bmi_min == null && s.bmi_max == null) flags.push("confirm BMI on call");
  if (s.age_max <= 40) flags.push(`age cap ${s.age_max} — verify`);
  if (s.currency === "CAD") flags.push("CAD → confirm passport/eligibility");

  return {
    ...s,
    pay_usd, inpatient_nights, nights_estimated, trips, drivable: isDrive,
    travel_cost, childcare_cost, childcare_by, net_cash, settle_days, payout_unconfirmed,
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
