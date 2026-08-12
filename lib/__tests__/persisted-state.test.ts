import { describe, expect, it } from "vitest";
import {
  computeBmi,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PROFILE,
  DEFAULT_SORT_KEY,
  sanitizePersistedState,
} from "../types";

// Pure-validator tests for the local-persistence-share-links story's shared
// "malformed input never throws, falls back to defaults" contract used by
// both lib/profile-store.ts (localStorage) and lib/share-link.ts (URL).

describe("sanitizePersistedState", () => {
  it("returns full defaults for undefined/null/garbage input", () => {
    expect(sanitizePersistedState(undefined)).toEqual({
      profile: DEFAULT_PROFILE,
      assumptions: DEFAULT_ASSUMPTIONS,
      sortKey: DEFAULT_SORT_KEY,
      backup_care_hubs: [],
    });
    expect(sanitizePersistedState(null)).toEqual({
      profile: DEFAULT_PROFILE,
      assumptions: DEFAULT_ASSUMPTIONS,
      sortKey: DEFAULT_SORT_KEY,
      backup_care_hubs: [],
    });
    expect(sanitizePersistedState("not an object")).toEqual({
      profile: DEFAULT_PROFILE,
      assumptions: DEFAULT_ASSUMPTIONS,
      sortKey: DEFAULT_SORT_KEY,
      backup_care_hubs: [],
    });
    expect(sanitizePersistedState(42)).toEqual({
      profile: DEFAULT_PROFILE,
      assumptions: DEFAULT_ASSUMPTIONS,
      sortKey: DEFAULT_SORT_KEY,
      backup_care_hubs: [],
    });
  });

  it("round-trips a fully valid state unchanged", () => {
    const valid = {
      profile: { ...DEFAULT_PROFILE, bmi: 30.1, weight_lb: 210, sex: "female" as const, smoker: true },
      assumptions: {
        ...DEFAULT_ASSUMPTIONS,
        home_base: { city: "Omaha, NE", lat: 41.2565, lng: -95.9345 },
        backup_care_rate_per_night: 250,
        w_net: 0.5,
        has_dependents_needing_care: true,
      },
      sortKey: "net_cash" as const,
      backup_care_hubs: ["AUS", "MSP"],
    };
    expect(sanitizePersistedState(valid)).toEqual(valid);
  });

  // story: editable-profile
  describe("profile", () => {
    it("defaults to DEFAULT_PROFILE when missing", () => {
      expect(sanitizePersistedState({}).profile).toEqual(DEFAULT_PROFILE);
    });

    it("keeps a valid height_in/weight_lb/sex/age/smoker/conditions as-is, deriving bmi from height+weight", () => {
      const result = sanitizePersistedState({
        profile: {
          height_in: 65,
          weight_lb: 240,
          sex: "female",
          age: 45,
          smoker: true,
          conditions: ["high_cholesterol"],
        },
      });
      expect(result.profile).toEqual({
        bmi: computeBmi(240, 65),
        height_in: 65,
        weight_lb: 240,
        weight_swing_lb: 0,
        sex: "female",
        age: 45,
        smoker: true,
        conditions: ["high_cholesterol"],
      });
    });

    // bmi is never trusted from raw input -- always recomputed from
    // height_in/weight_lb (see lib/types.ts's sanitizeProfile comment) --
    // so a stale/hand-edited bmi in localStorage or a share link can never
    // disagree with the height/weight that's actually stored alongside it.
    it("ignores an incoming bmi field entirely -- always recomputes it from height_in/weight_lb", () => {
      const result = sanitizePersistedState({
        profile: { bmi: 999, height_in: 70, weight_lb: 170 },
      });
      expect(result.profile.bmi).toBe(computeBmi(170, 70));
      expect(result.profile.bmi).not.toBe(999);
    });

    it("defaults individual malformed profile fields without discarding the rest", () => {
      const result = sanitizePersistedState({
        profile: { height_in: "not a number", weight_lb: 200, sex: "nonbinary", smoker: "yes" },
      });
      expect(result.profile.height_in).toBe(DEFAULT_PROFILE.height_in);
      expect(result.profile.weight_lb).toBe(200);
      expect(result.profile.bmi).toBe(computeBmi(200, DEFAULT_PROFILE.height_in));
      expect(result.profile.sex).toBe(DEFAULT_PROFILE.sex);
      expect(result.profile.smoker).toBe(DEFAULT_PROFILE.smoker);
    });

    it("never throws on garbage profile input", () => {
      expect(() => sanitizePersistedState({ profile: "garbage" })).not.toThrow();
      expect(() => sanitizePersistedState({ profile: null })).not.toThrow();
      expect(() => sanitizePersistedState({ profile: 42 })).not.toThrow();
      expect(sanitizePersistedState({ profile: "garbage" }).profile).toEqual(DEFAULT_PROFILE);
    });
  });

  // story: generalize-profile-inputs — any city is now valid, including a
  // plain free-text string with no coordinates (e.g. "seattle"); it's no
  // longer restricted to a 2-value literal union.
  it("accepts any home_base city (free string or {city,lat,lng}), never falls back for a valid shape", () => {
    const result = sanitizePersistedState({
      assumptions: { ...DEFAULT_ASSUMPTIONS, home_base: "seattle" },
    });
    expect(result.assumptions.home_base).toBe("seattle");
  });

  it("defaults individual malformed Assumptions fields without discarding the rest", () => {
    const result = sanitizePersistedState({
      assumptions: {
        ...DEFAULT_ASSUMPTIONS,
        home_base: { city: "Nowhere", lat: "not-a-number" }, // malformed shape -> falls back
        backup_care_rate_per_night: "two hundred", // wrong type -> falls back
        w_velocity: 0.9, // valid -> kept
      },
      sortKey: "not-a-real-sort-key",
    });

    expect(result.assumptions.home_base).toBe(DEFAULT_ASSUMPTIONS.home_base);
    expect(result.assumptions.backup_care_rate_per_night).toBe(
      DEFAULT_ASSUMPTIONS.backup_care_rate_per_night,
    );
    expect(result.assumptions.w_velocity).toBe(0.9);
    expect(result.sortKey).toBe(DEFAULT_SORT_KEY);
  });

  it("treats a missing assumptions key as fully-defaulted, not a throw", () => {
    const result = sanitizePersistedState({ sortKey: "downtime_rate" });
    expect(result.assumptions).toEqual(DEFAULT_ASSUMPTIONS);
    expect(result.sortKey).toBe("downtime_rate");
  });

  it("rejects non-finite numbers (NaN/Infinity) in Assumptions fields", () => {
    const result = sanitizePersistedState({
      assumptions: { ...DEFAULT_ASSUMPTIONS, flight_cost: Infinity, drive_cost: NaN },
    });
    expect(result.assumptions.flight_cost).toBe(DEFAULT_ASSUMPTIONS.flight_cost);
    expect(result.assumptions.drive_cost).toBe(DEFAULT_ASSUMPTIONS.drive_cost);
  });

  // story: configurable-backup-care-coverage
  describe("backup_care_hubs", () => {
    it("defaults to [] when missing", () => {
      expect(sanitizePersistedState({}).backup_care_hubs).toEqual([]);
    });

    it("keeps a valid array of hub-code strings", () => {
      const result = sanitizePersistedState({ backup_care_hubs: ["AUS", "MSP"] });
      expect(result.backup_care_hubs).toEqual(["AUS", "MSP"]);
    });

    it("dedupes repeated hub codes", () => {
      const result = sanitizePersistedState({ backup_care_hubs: ["AUS", "AUS", "MSP"] });
      expect(result.backup_care_hubs).toEqual(["AUS", "MSP"]);
    });

    it("drops non-string entries but keeps the valid ones", () => {
      const result = sanitizePersistedState({ backup_care_hubs: ["AUS", 42, null, {}, "MSP"] });
      expect(result.backup_care_hubs).toEqual(["AUS", "MSP"]);
    });

    it("drops empty-string entries", () => {
      const result = sanitizePersistedState({ backup_care_hubs: ["AUS", ""] });
      expect(result.backup_care_hubs).toEqual(["AUS"]);
    });

    it("falls back to [] for a non-array value (never throws)", () => {
      expect(sanitizePersistedState({ backup_care_hubs: "AUS" }).backup_care_hubs).toEqual([]);
      expect(sanitizePersistedState({ backup_care_hubs: { hub: "AUS" } }).backup_care_hubs).toEqual([]);
      expect(sanitizePersistedState({ backup_care_hubs: null }).backup_care_hubs).toEqual([]);
      expect(() => sanitizePersistedState({ backup_care_hubs: 42 })).not.toThrow();
    });
  });
});
