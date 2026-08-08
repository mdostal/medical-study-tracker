import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_COLUMNS,
  DEFAULT_COLUMN_CONFIG,
  clearColumnConfig,
  loadColumnConfig,
  sanitizeColumnConfig,
  saveColumnConfig,
  type ColumnConfig,
} from "../column-config-store";

// In-memory Storage stub — same convention as lib/__tests__/local-status-
// store.test.ts and lib/__tests__/profile-store.test.ts: stub the global
// `localStorage` identifier directly, no jsdom needed.
function makeFakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
}

describe("sanitizeColumnConfig", () => {
  it("falls back to the default config for non-array input", () => {
    expect(sanitizeColumnConfig(undefined)).toEqual(DEFAULT_COLUMN_CONFIG);
    expect(sanitizeColumnConfig(null)).toEqual(DEFAULT_COLUMN_CONFIG);
    expect(sanitizeColumnConfig({ not: "an array" })).toEqual(DEFAULT_COLUMN_CONFIG);
  });

  it("round-trips a valid reordered/partially-hidden config unchanged", () => {
    const config: ColumnConfig = [
      { id: "status", visible: true },
      { id: "study", visible: true },
      { id: "gross", visible: false },
    ];
    // Every other known column gets appended (visible) after the given ones.
    const result = sanitizeColumnConfig(config);
    expect(result.slice(0, 3)).toEqual(config);
    expect(result).toHaveLength(ALL_COLUMNS.length);
  });

  it("drops unknown column ids", () => {
    const result = sanitizeColumnConfig([{ id: "not-a-real-column", visible: true }]);
    expect(result.find((c) => (c.id as string) === "not-a-real-column")).toBeUndefined();
    expect(result).toHaveLength(ALL_COLUMNS.length);
  });

  it("keeps only the first occurrence of a duplicated id", () => {
    const result = sanitizeColumnConfig([
      { id: "gross", visible: false },
      { id: "gross", visible: true },
    ]);
    expect(result.filter((c) => c.id === "gross")).toEqual([{ id: "gross", visible: false }]);
  });

  it("appends any known column missing from a stale saved config, visible by default", () => {
    const result = sanitizeColumnConfig([{ id: "study", visible: true }]);
    expect(result).toHaveLength(ALL_COLUMNS.length);
    expect(result.every((c) => ALL_COLUMNS.some((def) => def.id === c.id))).toBe(true);
  });

  it("forces the locked-visible 'study' column visible even if input says hidden", () => {
    const result = sanitizeColumnConfig([{ id: "study", visible: false }]);
    expect(result.find((c) => c.id === "study")).toEqual({ id: "study", visible: true });
  });

  it("defaults a malformed 'visible' field to true", () => {
    const result = sanitizeColumnConfig([{ id: "gross", visible: "not-a-boolean" }]);
    expect(result.find((c) => c.id === "gross")).toEqual({ id: "gross", visible: true });
  });
});

describe("column-config-store persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeFakeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loadColumnConfig returns the default when nothing has been saved", () => {
    expect(loadColumnConfig()).toEqual(DEFAULT_COLUMN_CONFIG);
  });

  it("reload-persistence: save then load round-trips the exact config", () => {
    const config: ColumnConfig = [
      { id: "net_cash", visible: true },
      { id: "study", visible: true },
      { id: "gross", visible: false },
      { id: "payout", visible: true },
      { id: "nights", visible: true },
      { id: "trips", visible: true },
      { id: "travel", visible: true },
      { id: "childcare", visible: true },
      { id: "velocity", visible: true },
      { id: "downtime", visible: true },
      { id: "feasibility", visible: true },
      { id: "flags", visible: true },
      { id: "apply", visible: true },
      { id: "phone", visible: false },
      { id: "status", visible: true },
      { id: "rank", visible: true },
    ];
    saveColumnConfig(config);
    // Simulate a fresh page load re-reading from the same localStorage.
    expect(loadColumnConfig()).toEqual(config);
  });

  it("clearColumnConfig removes the saved config", () => {
    saveColumnConfig([{ id: "study", visible: true }]);
    clearColumnConfig();
    expect(loadColumnConfig()).toEqual(DEFAULT_COLUMN_CONFIG);
  });

  it("loadColumnConfig returns the default (not a throw) for corrupted stored JSON", () => {
    localStorage.setItem("mst.columnConfig.v1", "{not valid json");
    expect(() => loadColumnConfig()).not.toThrow();
    expect(loadColumnConfig()).toEqual(DEFAULT_COLUMN_CONFIG);
  });

  it("this is a sibling adapter, not a duplicate: it owns its own key, distinct from Profile's", () => {
    saveColumnConfig([{ id: "study", visible: true }]);
    expect(localStorage.getItem("mst.columnConfig.v1")).not.toBeNull();
    expect(localStorage.getItem("mst.profileState.v1")).toBeNull();
  });
});

describe("column-config-store without localStorage available", () => {
  it("no-ops gracefully (SSR / storage disabled) instead of throwing", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => saveColumnConfig(DEFAULT_COLUMN_CONFIG)).not.toThrow();
    expect(loadColumnConfig()).toEqual(DEFAULT_COLUMN_CONFIG);
    expect(() => clearColumnConfig()).not.toThrow();
    vi.unstubAllGlobals();
  });
});
