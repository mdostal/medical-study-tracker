import { describe, expect, it } from "vitest";
import { isEligible, scoreAll, scoreOne } from "../scoring";
import type { Assumptions, FriendMap, Profile, Study } from "../types";
import { DEFAULT_ASSUMPTIONS } from "../types";

// Smoke tests for the framework-free engine — these also double as the
// "npm test" proof for the scaffold story (scaffold-nextjs-app.yaml).

const study: Study = {
  id: "s1",
  network: "Example Network",
  city: "Example City",
  state: "TX",
  hub: "SA",
  pay_gross: 10000,
  currency: "USD",
  payout: { type: "lump_end", settle_days: 30 },
  stays: [5],
  visits: 1,
  bmi_min: 18.5,
  bmi_max: 30,
  age_min: 18,
  age_max: 55,
  sex: "M/F",
  smoker: "non",
  special_pop: null,
};

const profile: Profile = { bmi: 24, height_in: 70, weight_lb: 180, sex: "male", age: 32 };

// San Antonio, TX — a real hub with real coordinates. Used across the
// generalize-profile-inputs tests below to prove drivable() computes an
// actual distance rather than looking up a hardcoded per-city list.
const SAN_ANTONIO = { city: "San Antonio, TX", lat: 29.4241, lng: -98.4936 };
const AUSTIN = { city: "Austin, TX", lat: 30.2672, lng: -97.7431 }; // ~80mi from SA -> drivable
const SEATTLE = { city: "Seattle, WA", lat: 47.6062, lng: -122.3321 }; // ~2100mi from SA -> fly

const friendMap: FriendMap = {
  hubs: { SA: SAN_ANTONIO },
  backup_care_available: {},
};

const assumptions: Assumptions = DEFAULT_ASSUMPTIONS;

describe("isEligible", () => {
  it("accepts a profile inside the study's BMI range", () => {
    expect(isEligible(study, profile).ok).toBe(true);
  });

  it("rejects a profile below the study's BMI floor", () => {
    const result = isEligible(study, { ...profile, bmi: 15 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/BMI/);
  });

  // Found via a live-client QA pass: a senior-only study (age_min 61) showed
  // as eligible for a 25/32-year-old, because only age_max was ever checked.
  it("rejects a profile below the study's age floor", () => {
    const seniorOnly: Study = { ...study, age_min: 61, age_max: 80 };
    expect(isEligible(seniorOnly, { ...profile, age: 25 })).toEqual({
      ok: false,
      reason: "age < 61",
    });
    expect(isEligible(seniorOnly, { ...profile, age: 65 }).ok).toBe(true);
  });

  it("age gating: undefined profile.age never blocks on either bound", () => {
    const ageRestricted: Study = { ...study, age_min: 61, age_max: 80 };
    expect(isEligible(ageRestricted, { ...profile, age: undefined }).ok).toBe(true);
  });

  it("rejects a female-only study for a male profile", () => {
    const femaleOnly: Study = { ...study, sex: "female" };
    const result = isEligible(femaleOnly, profile);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("female-only");
  });

  // story: editable-profile -- eligibility used to be computed against a
  // single hardcoded example profile for every visitor, so an
  // overweight_obese-gated study always showed blocked regardless of the
  // real visitor's BMI. Proves a real higher-BMI profile is now accepted.
  it("accepts an overweight_obese-gated study for a profile with a qualifying BMI", () => {
    const obesityStudy: Study = { ...study, bmi_min: 27, bmi_max: 40, special_pop: "overweight_obese" };
    expect(isEligible(obesityStudy, { ...profile, bmi: 15 }).ok).toBe(false);
    expect(isEligible(obesityStudy, { ...profile, bmi: 32 }).ok).toBe(true);
  });

  it("smoker gating: undefined profile.smoker never blocks", () => {
    expect(isEligible(study, profile).ok).toBe(true);
    const smokerOnly: Study = { ...study, smoker: "smoker-only" };
    expect(isEligible(smokerOnly, profile).ok).toBe(true);
  });

  it("smoker gating: rejects a smoker for a non-smoker-only study", () => {
    const result = isEligible(study, { ...profile, smoker: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("non-smokers only");
  });

  it("smoker gating: rejects a non-smoker for a smoker-only study", () => {
    const smokerOnly: Study = { ...study, smoker: "smoker-only" };
    const result = isEligible(smokerOnly, { ...profile, smoker: false });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("smokers only");
  });

  it("smoker gating: accepts any smoker status for a smoker:any study", () => {
    const anySmoker: Study = { ...study, smoker: "any" };
    expect(isEligible(anySmoker, { ...profile, smoker: true }).ok).toBe(true);
    expect(isEligible(anySmoker, { ...profile, smoker: false }).ok).toBe(true);
  });
});

describe("scoreOne", () => {
  it("computes a net_cash figure for an eligible study", () => {
    const scored = scoreOne(study, profile, assumptions, friendMap);
    expect(scored.net_cash).toBeGreaterThan(0);
    expect(scored.feasibility).not.toBe("BLOCKED");
  });
});

describe("scoreAll", () => {
  it("ranks eligible studies and separates blocked ones", () => {
    const blockedStudy: Study = { ...study, id: "s2", eligible: false, exclude_reason: "closed" };
    const { eligible, blocked } = scoreAll(
      [study, blockedStudy],
      profile,
      assumptions,
      friendMap,
    );
    expect(eligible.map((s) => s.id)).toContain("s1");
    expect(blocked.map((s) => s.id)).toContain("s2");
  });
});

// story: generalize-profile-inputs — Part A: any home base, real distance.
describe("drivable() via real distance (no austin/omaha special-casing)", () => {
  it("classifies a nearby home base as drivable", () => {
    const scored = scoreOne(
      study,
      profile,
      { ...assumptions, home_base: AUSTIN },
      friendMap,
    );
    expect(scored.drivable).toBe(true);
    expect(scored.travel_cost).toBe(scored.trips * assumptions.drive_cost);
  });

  it("classifies a home base far from any hub (e.g. Seattle) as fly, not drivable", () => {
    const scored = scoreOne(
      study,
      profile,
      { ...assumptions, home_base: SEATTLE },
      friendMap,
    );
    expect(scored.drivable).toBe(false);
    expect(scored.travel_cost).toBe(scored.trips * assumptions.flight_cost);
  });

  it("with no home base set at all, still scores every study (conservative flight cost)", () => {
    const scored = scoreOne(study, profile, { ...assumptions, home_base: null }, friendMap);
    expect(scored.drivable).toBe(false);
    expect(scored.travel_cost).toBe(scored.trips * assumptions.flight_cost);
    expect(scored.feasibility).not.toBe("BLOCKED");
  });

  it("a plain city string with no coordinates also falls back to fly (conservative)", () => {
    const scored = scoreOne(
      study,
      profile,
      { ...assumptions, home_base: "Some Unlisted Town, ZZ" },
      friendMap,
    );
    expect(scored.drivable).toBe(false);
    expect(scored.travel_cost).toBe(scored.trips * assumptions.flight_cost);
  });

  it("scoreAll still ranks/shows every eligible study with no home base set", () => {
    const { eligible } = scoreAll([study], profile, { ...assumptions, home_base: null }, friendMap);
    expect(eligible).toHaveLength(1);
  });
});

// story: generalize-profile-inputs — Part B: has_dependents_needing_care +
// backup_care_rate_per_night, replacing the old always-on fixed-rate model.
describe("backup-care cost (has_dependents_needing_care + backup_care_rate_per_night)", () => {
  const longStay: Study = { ...study, stays: [10] }; // > default friend_threshold_nights (3)

  it("is $0 for every study when has_dependents_needing_care is false, regardless of stay length", () => {
    const scored = scoreOne(
      longStay,
      profile,
      { ...assumptions, has_dependents_needing_care: false },
      friendMap,
    );
    expect(scored.backup_care_cost).toBe(0);
    expect(scored.backup_care_by).toBe("no-dependents");
  });

  it("uses the user's own backup_care_rate_per_night, not a hardcoded constant, when true", () => {
    const scored = scoreOne(
      longStay,
      profile,
      { ...assumptions, has_dependents_needing_care: true, backup_care_rate_per_night: 340 },
      friendMap,
    );
    expect(scored.backup_care_cost).toBe(10 * 340);
    expect(scored.backup_care_by).toBe("paid-backup-care");
  });

  // story: configurable-backup-care-coverage — a short stay costing $0
  // because of friend_threshold_nights is a DIFFERENT reason than hub-based
  // free coverage (fm.backup_care_available) and must be labeled
  // differently, so a fresh visitor with zero configured hubs never sees a
  // "free coverage" badge on a short-stay study.
  it("is $0 for a stay within friend_threshold_nights even with dependents, labeled short-stay-no-cost (not free-coverage)", () => {
    const shortStay: Study = { ...study, stays: [2] };
    const scored = scoreOne(
      shortStay,
      profile,
      { ...assumptions, has_dependents_needing_care: true, backup_care_rate_per_night: 500 },
      friendMap,
    );
    expect(scored.backup_care_cost).toBe(0);
    expect(scored.backup_care_by).toBe("short-stay-no-cost");
  });

  it("is $0 and labeled short-stay-no-cost (not free-coverage) with NO hub configured at all", () => {
    const shortStay: Study = { ...study, stays: [2] };
    const emptyFriendMap: FriendMap = { hubs: {}, backup_care_available: {} };
    const scored = scoreOne(
      shortStay,
      profile,
      { ...assumptions, has_dependents_needing_care: true },
      emptyFriendMap,
    );
    expect(scored.backup_care_by).toBe("short-stay-no-cost");
    expect(scored.backup_care_by).not.toBe("free-coverage");
  });

  it("is $0 for a long stay in a hub with user-stated free coverage", () => {
    const fmWithCoverage: FriendMap = {
      hubs: { SA: SAN_ANTONIO },
      backup_care_available: { SA: { note: "Example: user has a contact there." } },
    };
    const scored = scoreOne(
      longStay,
      profile,
      { ...assumptions, has_dependents_needing_care: true, backup_care_rate_per_night: 500 },
      fmWithCoverage,
    );
    expect(scored.backup_care_cost).toBe(0);
    expect(scored.backup_care_by).toBe("free-coverage");
  });
});
