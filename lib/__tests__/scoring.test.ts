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

const profile: Profile = { bmi: 24, weight_lb: 180, sex: "male", age: 32 };

const friendMap: FriendMap = {
  hubs: {},
  friend_metros: [],
  base_drive_hubs: {},
  home_base_childcare: {},
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

  it("rejects a female-only study for a male profile", () => {
    const femaleOnly: Study = { ...study, sex: "female" };
    const result = isEligible(femaleOnly, profile);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("female-only");
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
