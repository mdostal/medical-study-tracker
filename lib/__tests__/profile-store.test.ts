import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPersistedState, loadPersistedState, savePersistedState } from "../profile-store";
import { DEFAULT_ASSUMPTIONS, DEFAULT_SORT_KEY, type PersistedState } from "../types";

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
      assumptions: { ...DEFAULT_ASSUMPTIONS, home_base: "omaha", nanny_rate: 300 },
      sortKey: "downtime_rate",
    };
    savePersistedState(state);
    expect(loadPersistedState()).toEqual(state);
  });

  it("clearPersistedState removes the saved state", () => {
    savePersistedState({ assumptions: DEFAULT_ASSUMPTIONS, sortKey: DEFAULT_SORT_KEY });
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
      JSON.stringify({ assumptions: { ...DEFAULT_ASSUMPTIONS, home_base: "not-a-city" }, sortKey: "score" }),
    );
    expect(loadPersistedState()).toEqual({
      assumptions: DEFAULT_ASSUMPTIONS,
      sortKey: "score",
    });
  });
});

describe("profile-store without localStorage available", () => {
  it("no-ops/returns null instead of throwing when localStorage is undefined", () => {
    // Default vitest "node" environment has no global localStorage at all —
    // this exercises that path directly, no stub needed.
    expect(() => loadPersistedState()).not.toThrow();
    expect(loadPersistedState()).toBeNull();
    expect(() =>
      savePersistedState({ assumptions: DEFAULT_ASSUMPTIONS, sortKey: DEFAULT_SORT_KEY }),
    ).not.toThrow();
    expect(() => clearPersistedState()).not.toThrow();
  });
});
