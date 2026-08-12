import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  compareByColumn,
  filterAndSort,
  isDefaultFilters,
  isSortableColumn,
  matchesFilters,
  type TableFilters,
} from "../table-sort-filter";
import { scoreOne } from "../scoring";
import { DEFAULT_ASSUMPTIONS } from "../types";
import type { Assumptions, FriendMap, Profile, Study } from "../types";
import { DEFAULT_STATUS, type StudyStatus } from "../local-status-store";

// Unit tests for this story's generic per-column sort + combinable filters —
// the pure logic lives as plain exported functions in components/ranked-
// table.tsx specifically so it's testable without rendering React (matching
// this repo's existing convention: no jsdom/@testing-library dependency).

const profile: Profile = { bmi: 24, height_in: 70, weight_lb: 180, weight_swing_lb: 0, sex: "male", age: 32 };
const friendMap: FriendMap = {
  hubs: {},
  backup_care_available: {},
};
const assumptions: Assumptions = DEFAULT_ASSUMPTIONS;

function makeStudy(overrides: Partial<Study>): Study {
  return {
    id: "s1",
    network: "Net A",
    city: "San Antonio",
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
    ...overrides,
  };
}

const A = scoreOne(
  makeStudy({ id: "A", network: "Net A", hub: "SA", pay_gross: 5000, stays: [3] }),
  profile,
  assumptions,
  friendMap,
);
const B = scoreOne(
  makeStudy({ id: "B", network: "Net B", hub: "OMA", pay_gross: 15000, stays: [10] }),
  profile,
  assumptions,
  friendMap,
);
const C = scoreOne(
  makeStudy({ id: "C", network: "Net A", hub: "OMA", pay_gross: 9000, stays: [7] }),
  profile,
  assumptions,
  friendMap,
);

const statusMap: Record<string, StudyStatus> = { A: "called", B: DEFAULT_STATUS };

describe("isSortableColumn", () => {
  it("is true for scalar-valued columns", () => {
    expect(isSortableColumn("net_cash")).toBe(true);
    expect(isSortableColumn("study")).toBe(true);
    expect(isSortableColumn("status")).toBe(true);
  });

  it("is false for display-only columns with no unambiguous scalar", () => {
    expect(isSortableColumn("flags")).toBe(false);
    expect(isSortableColumn("apply")).toBe(false);
    expect(isSortableColumn("phone")).toBe(false);
    expect(isSortableColumn("rank")).toBe(false);
  });
});

describe("compareByColumn", () => {
  it("sorts ascending by a numeric column", () => {
    const sorted = [B, A, C].sort((x, y) => compareByColumn(x, y, "net_cash", "asc", {}));
    expect(sorted.map((s) => s.id)).toEqual(
      [A, B, C].map((s) => s.id).sort((idA, idB) => {
        const byId = { A, B, C } as Record<string, typeof A>;
        return byId[idA].net_cash - byId[idB].net_cash;
      }),
    );
  });

  it("ascending then descending on the same column reverses the order — AC1", () => {
    const asc = [A, B, C].slice().sort((x, y) => compareByColumn(x, y, "net_cash", "asc", {}));
    const desc = [A, B, C].slice().sort((x, y) => compareByColumn(x, y, "net_cash", "desc", {}));
    expect(desc.map((s) => s.id)).toEqual(asc.map((s) => s.id).reverse());
  });

  it("sorts by an arbitrary (non-SCORING.md) column, e.g. study id — AC1", () => {
    const sorted = [B, C, A].sort((x, y) => compareByColumn(x, y, "study", "asc", {}));
    expect(sorted.map((s) => s.id)).toEqual(["A", "B", "C"]);
  });

  it("sorts by the per-visitor status column using the given status map", () => {
    // called (index 1 in STATUS_ORDER) vs. not-started (index 0) vs. not-started (default)
    const sorted = [C, A, B].sort((x, y) => compareByColumn(x, y, "status", "asc", statusMap));
    expect(sorted[sorted.length - 1].id).toBe("A"); // "called" sorts after "not-started"
  });
});

describe("matchesFilters — combinable AND across dimensions (AC2)", () => {
  it("matches everything under the default (all) filters", () => {
    expect(matchesFilters(A, DEFAULT_FILTERS, {})).toBe(true);
    expect(matchesFilters(B, DEFAULT_FILTERS, {})).toBe(true);
  });

  it("filters by a single dimension (hub)", () => {
    const filters: TableFilters = { ...DEFAULT_FILTERS, hub: "SA" };
    expect(matchesFilters(A, filters, {})).toBe(true);
    expect(matchesFilters(B, filters, {})).toBe(false);
  });

  it("combines hub AND network filters — must satisfy both", () => {
    const filters: TableFilters = { ...DEFAULT_FILTERS, hub: "OMA", network: "Net A" };
    expect(matchesFilters(C, filters, {})).toBe(true); // hub OMA, network Net A
    expect(matchesFilters(B, filters, {})).toBe(false); // hub OMA, but network Net B
    expect(matchesFilters(A, filters, {})).toBe(false); // network Net A, but hub SA
  });

  it("filters by feasibility", () => {
    const filters: TableFilters = { ...DEFAULT_FILTERS, feasibility: A.feasibility };
    expect(matchesFilters(A, filters, {})).toBe(true);
  });

  it("filters by the per-visitor status, defaulting missing entries to not-started", () => {
    const filters: TableFilters = { ...DEFAULT_FILTERS, status: "called" };
    expect(matchesFilters(A, filters, statusMap)).toBe(true);
    expect(matchesFilters(B, filters, statusMap)).toBe(false);
    expect(matchesFilters(C, filters, {})).toBe(false); // no entry -> not-started, not "called"
  });
});

describe("isDefaultFilters", () => {
  it("is true only for the untouched default", () => {
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, hub: "SA" })).toBe(false);
  });
});

describe("filterAndSort", () => {
  it("with no sort, preserves the given (already-ranked) order — AC4 default behavior", () => {
    const list = [B, A, C];
    expect(filterAndSort(list, DEFAULT_FILTERS, {}, null).map((s) => s.id)).toEqual(["B", "A", "C"]);
  });

  it("applies the filter before sorting", () => {
    const filters: TableFilters = { ...DEFAULT_FILTERS, network: "Net A" };
    const result = filterAndSort([B, A, C], filters, {}, { column: "study", dir: "asc" });
    expect(result.map((s) => s.id)).toEqual(["A", "C"]);
  });
});
