import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addUserStudy,
  clearPersistedState,
  loadPersistedState,
  loadUserStudies,
  removeUserStudy,
  savePersistedState,
  saveUserStudies,
} from "../profile-store";
import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PROFILE,
  DEFAULT_SORT_KEY,
  type PersistedState,
  type Study,
} from "../types";

// In-memory Storage stub — avoids pulling in jsdom just for localStorage.
// Stubbed onto the global `localStorage` identifier (not `window`), matching
// lib/profile-store.ts's / lib/local-status-store.ts's shared convention.
function makeFakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

describe("profile-store (localStorage adapter)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeFakeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loadPersistedState returns null when nothing has been saved", () => {
    expect(loadPersistedState()).toBeNull();
  });

  it("reload-persistence: save then load round-trips the exact state", () => {
    const state: PersistedState = {
      profile: { ...DEFAULT_PROFILE, bmi: 29, weight_lb: 210 },
      assumptions: {
        ...DEFAULT_ASSUMPTIONS,
        home_base: { city: "Omaha, NE", lat: 41.2565, lng: -95.9345 },
        backup_care_rate_per_night: 300,
      },
      sortKey: "downtime_rate",
      backup_care_hubs: ["AUS", "SLC"],
    };
    savePersistedState(state);
    expect(loadPersistedState()).toEqual(state);
  });

  it("clearPersistedState removes the saved state", () => {
    savePersistedState({
      profile: DEFAULT_PROFILE,
      assumptions: DEFAULT_ASSUMPTIONS,
      sortKey: DEFAULT_SORT_KEY,
      backup_care_hubs: [],
    });
    clearPersistedState();
    expect(loadPersistedState()).toBeNull();
  });

  it("loadPersistedState returns null (not a throw) for corrupted stored JSON", () => {
    localStorage.setItem("mst.profileState.v1", "{not valid json");
    expect(() => loadPersistedState()).not.toThrow();
    expect(loadPersistedState()).toBeNull();
  });

  it("loadPersistedState sanitizes a stored value with a malformed field", () => {
    localStorage.setItem(
      "mst.profileState.v1",
      // home_base as a bare number is malformed (not null/string/{city,lat,lng})
      // -> falls back. A plain string like "not-a-city" is now VALID (any
      // free-text city works, per generalize-profile-inputs) and would not
      // trigger the fallback this test exercises.
      JSON.stringify({ assumptions: { ...DEFAULT_ASSUMPTIONS, home_base: 12345 }, sortKey: "score" }),
    );
    expect(loadPersistedState()).toEqual({
      profile: DEFAULT_PROFILE,
      assumptions: DEFAULT_ASSUMPTIONS,
      sortKey: "score",
      backup_care_hubs: [],
    });
  });
});

// story: add-study-by-url — user-added studies list, sharing the same
// localStorage adapter as the Profile above (a different key, same module).
describe("profile-store user-added studies", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeFakeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sampleStudy: Study = {
    id: "user-friendco-abc123",
    network: "Friend's CRO",
    city: "Austin",
    state: "TX",
    hub: "",
    pay_gross: 5000,
    currency: "USD",
    payout: { type: "unknown", settle_days: null },
    stays: [8],
    visits: 2,
    bmi_min: null,
    bmi_max: null,
    age_min: 18,
    age_max: 99,
    sex: "M/F",
    smoker: "any",
    special_pop: null,
    status: "enrolling",
    source_url: "https://iconstudies.com/study/1",
  };

  it("loadUserStudies returns [] when nothing has been added", () => {
    expect(loadUserStudies()).toEqual([]);
  });

  it("addUserStudy persists the study and tags it user_added:true even if not passed in", () => {
    const result = addUserStudy(sampleStudy);
    expect(result).toEqual([{ ...sampleStudy, user_added: true }]);
    expect(loadUserStudies()).toEqual([{ ...sampleStudy, user_added: true }]);
  });

  it("addUserStudy appends without clobbering a prior entry", () => {
    addUserStudy(sampleStudy);
    addUserStudy({ ...sampleStudy, id: "user-friendco-def456" });
    expect(loadUserStudies().map((s) => s.id)).toEqual([
      "user-friendco-abc123",
      "user-friendco-def456",
    ]);
  });

  it("removeUserStudy removes only the matching id", () => {
    addUserStudy(sampleStudy);
    addUserStudy({ ...sampleStudy, id: "user-friendco-def456" });
    removeUserStudy("user-friendco-abc123");
    expect(loadUserStudies().map((s) => s.id)).toEqual(["user-friendco-def456"]);
  });

  it("loadUserStudies drops corrupt entries instead of throwing", () => {
    localStorage.setItem(
      "mst.userStudies.v1",
      JSON.stringify([sampleStudy, { garbage: true }, "not an object", 42]),
    );
    expect(() => loadUserStudies()).not.toThrow();
    expect(loadUserStudies()).toEqual([{ ...sampleStudy, user_added: true }]);
  });

  it("loadUserStudies returns [] (not a throw) for corrupted stored JSON", () => {
    localStorage.setItem("mst.userStudies.v1", "{not valid json");
    expect(() => loadUserStudies()).not.toThrow();
    expect(loadUserStudies()).toEqual([]);
  });

  it("saveUserStudies + loadUserStudies round-trip a list", () => {
    saveUserStudies([sampleStudy]);
    expect(loadUserStudies()).toEqual([{ ...sampleStudy, user_added: true }]);
  });

  it("never leaves the visitor's browser: only localStorage is touched, nothing network-adjacent", () => {
    // addUserStudy/loadUserStudies/saveUserStudies/removeUserStudy are pure
    // localStorage reads/writes with no fetch/XHR — this test documents
    // that contract by asserting no global fetch was ever invoked.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    addUserStudy(sampleStudy);
    loadUserStudies();
    removeUserStudy(sampleStudy.id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("profile-store user studies without localStorage available", () => {
  it("no-ops/returns [] instead of throwing when localStorage is undefined", () => {
    expect(() => loadUserStudies()).not.toThrow();
    expect(loadUserStudies()).toEqual([]);
    expect(() => addUserStudy({ id: "x" } as Study)).not.toThrow();
  });
});

describe("profile-store without localStorage available", () => {
  it("no-ops/returns null instead of throwing when localStorage is undefined", () => {
    // Default vitest "node" environment has no global localStorage at all —
    // this exercises that path directly, no stub needed.
    expect(() => loadPersistedState()).not.toThrow();
    expect(loadPersistedState()).toBeNull();
    expect(() =>
      savePersistedState({
        profile: DEFAULT_PROFILE,
        assumptions: DEFAULT_ASSUMPTIONS,
        sortKey: DEFAULT_SORT_KEY,
        backup_care_hubs: [],
      }),
    ).not.toThrow();
    expect(() => clearPersistedState()).not.toThrow();
  });
});
