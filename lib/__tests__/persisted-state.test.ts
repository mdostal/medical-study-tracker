import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_SORT_KEY,
  sanitizePersistedState,
} from "../types";

// Pure-validator tests for the local-persistence-share-links story's shared
// "malformed input never throws, falls back to defaults" contract used by
// both lib/profile-store.ts (localStorage) and lib/share-link.ts (URL).

describe("sanitizePersistedState", () => {
  it("returns full defaults for undefined/null/garbage input", () => {
    expect(sanitizePersistedState(undefined)).toEqual({
      assumptions: DEFAULT_ASSUMPTIONS,
      sortKey: DEFAULT_SORT_KEY,
    });
    expect(sanitizePersistedState(null)).toEqual({
      assumptions: DEFAULT_ASSUMPTIONS,
      sortKey: DEFAULT_SORT_KEY,
    });
    expect(sanitizePersistedState("not an object")).toEqual({
      assumptions: DEFAULT_ASSUMPTIONS,
      sortKey: DEFAULT_SORT_KEY,
    });
    expect(sanitizePersistedState(42)).toEqual({
      assumptions: DEFAULT_ASSUMPTIONS,
      sortKey: DEFAULT_SORT_KEY,
    });
  });

  it("round-trips a fully valid state unchanged", () => {
    const valid = {
      assumptions: {
        ...DEFAULT_ASSUMPTIONS,
        home_base: { city: "Omaha, NE", lat: 41.2565, lng: -95.9345 },
        backup_care_rate_per_night: 250,
        w_net: 0.5,
        has_dependents_needing_care: true,
      },
      sortKey: "net_cash" as const,
    };
    expect(sanitizePersistedState(valid)).toEqual(valid);
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
});
