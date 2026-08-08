import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STATUS,
  STATUS_ORDER,
  cycleStatus,
  getStoredStatus,
  loadStatusMap,
  setStoredStatus,
  type StudyStatus,
} from "../local-status-store";

// Fake localStorage, stubbed onto the global object the same way a real
// browser exposes it — proves lib/local-status-store.ts is genuinely
// framework-free (reads the global `localStorage` identifier directly, not
// `window.localStorage`) since this test runs under vitest's default node
// environment, no jsdom required.
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

describe("cycleStatus", () => {
  it("cycles through the exact order from the prototype's click-to-cycle pattern", () => {
    expect(STATUS_ORDER).toEqual([
      "not-started",
      "called",
      "screening",
      "enrolled",
      "done",
      "not-eligible",
    ]);
  });

  it("advances one step at a time and wraps from the last value to the first", () => {
    let status: StudyStatus = "not-started";
    const seen: StudyStatus[] = [status];
    for (let i = 0; i < STATUS_ORDER.length; i++) {
      status = cycleStatus(status);
      seen.push(status);
    }
    expect(seen).toEqual([
      "not-started",
      "called",
      "screening",
      "enrolled",
      "done",
      "not-eligible",
      "not-started",
    ]);
  });
});

describe("local-status-store persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeFakeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults an unknown study to not-started", () => {
    expect(getStoredStatus("study-with-no-history")).toBe(DEFAULT_STATUS);
  });

  it("persists a status change and reads it back (reload simulation)", () => {
    setStoredStatus("s1", "called");
    // Simulate a fresh page load re-reading from the same localStorage.
    expect(getStoredStatus("s1")).toBe("called");
  });

  it("only touches the one study's entry, leaving others alone", () => {
    setStoredStatus("s1", "enrolled");
    setStoredStatus("s2", "screening");
    expect(loadStatusMap()).toEqual({ s1: "enrolled", s2: "screening" });
    setStoredStatus("s1", "done");
    expect(loadStatusMap()).toEqual({ s1: "done", s2: "screening" });
  });

  it("ignores corrupt JSON in storage instead of throwing", () => {
    localStorage.setItem("mst.studyStatus.v1", "{not json");
    expect(loadStatusMap()).toEqual({});
    expect(getStoredStatus("s1")).toBe(DEFAULT_STATUS);
  });

  it("drops entries with an invalid status value rather than trusting them", () => {
    localStorage.setItem(
      "mst.studyStatus.v1",
      JSON.stringify({ s1: "called", s2: "not-a-real-status" }),
    );
    expect(loadStatusMap()).toEqual({ s1: "called" });
  });
});

describe("local-status-store without localStorage available", () => {
  it("no-ops gracefully (SSR / storage disabled) instead of throwing", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => setStoredStatus("s1", "called")).not.toThrow();
    expect(getStoredStatus("s1")).toBe(DEFAULT_STATUS);
    vi.unstubAllGlobals();
  });
});
