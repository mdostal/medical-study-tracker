import { describe, expect, it } from "vitest";
import { DEFAULT_WASHOUT_DAYS, suggestStack } from "../stack-suggester";
import type { ScoredStudy } from "../types";

// Minimal ScoredStudy fixtures — only the fields suggestStack actually reads
// (net_cash, inpatient_nights, washout_days) need real values; the rest are
// present only to satisfy the type.
function study(overrides: Partial<ScoredStudy> & { id: string }): ScoredStudy {
  return {
    network: "Example Network",
    city: "Example City",
    state: "TX",
    hub: "SA",
    pay_gross: 0,
    currency: "USD",
    payout: { type: "lump_end", settle_days: 30 },
    stays: [10],
    visits: 0,
    bmi_min: null,
    bmi_max: null,
    age_min: 18,
    age_max: 65,
    sex: "M/F",
    smoker: "non",
    special_pop: null,
    pay_usd: 0,
    inpatient_nights: 10,
    nights_estimated: false,
    trips: 1,
    drivable: true,
    travel_cost: 0,
    backup_care_cost: 0,
    backup_care_by: "no-dependents",
    net_cash: 0,
    settle_days: 30,
    payout_unconfirmed: false,
    cash_velocity: 0,
    downtime_days: 10,
    downtime_rate: 0,
    eff_per_night: null,
    feasibility: "EASY",
    score: 0,
    flags: [],
    via_swing: false,
    ...overrides,
  };
}

describe("suggestStack", () => {
  it("finds a single study that already clears the target with no washout gap needed", () => {
    const a = study({ id: "A", net_cash: 20000, inpatient_nights: 10 });
    const b = study({ id: "B", net_cash: 5000, inpatient_nights: 5 });
    const result = suggestStack([a, b], 15000);
    expect(result.found).toBe(true);
    expect(result.schedule!.legs.map((l) => l.study.id)).toEqual(["A"]);
    expect(result.schedule!.legs[0].washout_after_days).toBe(0);
  });

  it("combines multiple studies when no single one clears the target", () => {
    const a = study({ id: "A", net_cash: 12000, inpatient_nights: 10 });
    const b = study({ id: "B", net_cash: 9000, inpatient_nights: 8 });
    const c = study({ id: "C", net_cash: 4000, inpatient_nights: 4 });
    const result = suggestStack([a, b, c], 20000);
    expect(result.found).toBe(true);
    expect(result.schedule!.total_net_cash).toBeGreaterThanOrEqual(20000);
    // A+B (21000) beats A+B+C on downtime while still clearing the target.
    expect(result.schedule!.legs.map((l) => l.study.id).sort()).toEqual(["A", "B"]);
  });

  it("never schedules two legs with overlapping confinement windows", () => {
    const a = study({ id: "A", net_cash: 12000, inpatient_nights: 10, washout_days: 45 });
    const b = study({ id: "B", net_cash: 12000, inpatient_nights: 8, washout_days: 20 });
    const result = suggestStack([a, b], 20000);
    const legs = result.schedule!.legs;
    expect(legs.length).toBe(2);
    for (let i = 0; i < legs.length - 1; i++) {
      expect(legs[i + 1].start_day).toBeGreaterThan(legs[i].end_day);
    }
  });

  it("enforces at least a ~30-day washout gap between consecutive studies' dosing, using the larger of the study's own washout_days and the 30-day floor", () => {
    const a = study({ id: "A", net_cash: 12000, inpatient_nights: 10, washout_days: 45 });
    const b = study({ id: "B", net_cash: 12000, inpatient_nights: 8, washout_days: 10 });
    const result = suggestStack([a, b], 20000);
    const legs = result.schedule!.legs;
    // B (washout 10, floored to 30) is scheduled first per the
    // ascending-washout ordering, so its floored 30-day gap is the one paid.
    const firstLeg = legs[0];
    const secondLeg = legs[1];
    const gap = secondLeg.start_day - (firstLeg.end_day + 1);
    expect(gap).toBeGreaterThanOrEqual(DEFAULT_WASHOUT_DAYS);
    expect(firstLeg.washout_after_days).toBeGreaterThanOrEqual(DEFAULT_WASHOUT_DAYS);
  });

  it("floors washout at 30 days even when a study specifies less", () => {
    const a = study({ id: "A", net_cash: 12000, inpatient_nights: 10, washout_days: 5 });
    const b = study({ id: "B", net_cash: 12000, inpatient_nights: 8, washout_days: 5 });
    const result = suggestStack([a, b], 20000);
    const [first] = result.schedule!.legs;
    expect(first.washout_after_days).toBe(DEFAULT_WASHOUT_DAYS);
  });

  it("prefers the lowest total-downtime combination among those that clear the target", () => {
    // Long+cheap vs short+pricier: both clear 15000, the short one should win.
    const long = study({ id: "LONG", net_cash: 15000, inpatient_nights: 40 });
    const short = study({ id: "SHORT", net_cash: 16000, inpatient_nights: 10 });
    const result = suggestStack([long, short], 15000);
    expect(result.schedule!.legs.map((l) => l.study.id)).toEqual(["SHORT"]);
  });

  it("says so explicitly, with no schedule, when no combination clears the target", () => {
    const a = study({ id: "A", net_cash: 5000, inpatient_nights: 5 });
    const b = study({ id: "B", net_cash: 4000, inpatient_nights: 4 });
    const result = suggestStack([a, b], 100000);
    expect(result.found).toBe(false);
    expect(result.schedule).toBeNull();
    expect(result.reason).toBeTruthy();
    expect(result.reason).toMatch(/100,000/);
  });

  it("reports no combination when nothing has positive net cash", () => {
    const a = study({ id: "A", net_cash: 0, inpatient_nights: 5 });
    const result = suggestStack([a], 1000);
    expect(result.found).toBe(false);
    expect(result.best_achievable_net_cash).toBe(0);
  });
});
