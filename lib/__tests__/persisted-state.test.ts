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
        home_base: "omaha" as const,
        nanny_rate: 250,
        w_net: 0.5,
        model_childcare: true,
      },
      sortKey: "net_cash" as const,
    };
    expect(sanitizePersistedState(valid)).toEqual(valid);
  });

  it("defaults individual malformed Assumptions fields without discarding the rest", () => {
    const result = sanitizePersistedState({
      assumptions: {
        ...DEFAULT_ASSUMPTIONS,
        home_base: "seattle", // not a valid literal -> falls back
        nanny_rate: "two hundred", // wrong type -> falls back
        w_velocity: 0.9, // valid -> kept
      },
      sortKey: "not-a-real-sort-key",
    });

    expect(result.assumptions.home_base).toBe(DEFAULT_ASSUMPTIONS.home_base);
    expect(result.assumptions.nanny_rate).toBe(DEFAULT_ASSUMPTIONS.nanny_rate);
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
