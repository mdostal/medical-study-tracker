import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearApplications,
  createApplication,
  getApplication,
  loadApplications,
  removeApplication,
  saveApplications,
  startApplication,
  upsertApplication,
} from "../application-store";
import {
  DEFAULT_APPLICATION_CHANNEL,
  DEFAULT_CHASE_STATE,
  DEFAULT_LIFECYCLE_STATUS,
  type Application,
} from "../types";

// In-memory Storage stub — same pattern as lib/__tests__/profile-store.test.ts
// and lib/__tests__/local-status-store.test.ts, stubbed onto the global
// `localStorage` identifier (not `window`), proving this module is genuinely
// framework-free (no jsdom needed).
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

// Entirely generic placeholder — a fictional-range phone number (555-01xx is
// reserved for fiction, never a real assignable number), no real name, no
// real biometric figure. Never sourced from the shared reference artifact.
const SAMPLE_APPLICATION: Application = {
  study_id: "study-generic-001",
  channel: "call",
  status: "phone-screen",
  chase_state: "waiting",
  applied_date: "2026-01-05",
  confirmation: { has_number: true, confirmed_in_system: true, no_email_flag: false, ref: "CONF-0001" },
  contact: { phone: "+1-555-0100", scheduler_url: "https://example-clinic.test/book", tz: "America/Chicago" },
  next_action: "call to push",
  next_action_due: "2026-01-12",
  urgency: "this_week",
  call_log: [
    { date: "2026-01-05", who: "clinic coordinator", summary: "Confirmed screening slot availability." },
  ],
  screening_date: "2026-01-15",
  cohort_dates: ["2026-02-01", "2026-02-08"],
  confirmed: { nights: [3, 4], visits: 2, bmi_ok: true },
  payout: { type: "lump_end", settle_days: 14 },
  washout_days: 30,
  stipend_per_visit: 50,
  notes: "Generic placeholder note.",
};

describe("createApplication", () => {
  it("builds a fresh record defaulting to the start of the pipeline", () => {
    const app = createApplication("study-x");
    expect(app.study_id).toBe("study-x");
    expect(app.status).toBe(DEFAULT_LIFECYCLE_STATUS);
    expect(app.chase_state).toBe(DEFAULT_CHASE_STATE);
    expect(app.channel).toBe(DEFAULT_APPLICATION_CHANNEL);
    expect(app.call_log).toEqual([]);
    expect(app.confirmed).toEqual({});
    expect(app.confirmation).toEqual({
      has_number: false,
      confirmed_in_system: false,
      no_email_flag: false,
    });
  });

  it("honors an explicit channel", () => {
    expect(createApplication("study-x", "self_book").channel).toBe("self_book");
  });
});

describe("application-store (localStorage adapter)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeFakeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loadApplications returns {} when nothing has been saved", () => {
    expect(loadApplications()).toEqual({});
  });

  it("getApplication returns undefined for a study with no record", () => {
    expect(getApplication("study-with-no-history")).toBeUndefined();
  });

  it("reload-persistence: save then load round-trips the exact map", () => {
    const map = { [SAMPLE_APPLICATION.study_id]: SAMPLE_APPLICATION };
    saveApplications(map);
    expect(loadApplications()).toEqual(map);
  });

  it("upsertApplication persists one entry and getApplication reads it back", () => {
    upsertApplication(SAMPLE_APPLICATION.study_id, SAMPLE_APPLICATION);
    expect(getApplication(SAMPLE_APPLICATION.study_id)).toEqual(SAMPLE_APPLICATION);
  });

  it("upsertApplication only touches the one study's entry, leaving others alone", () => {
    const second: Application = createApplication("study-generic-002", "self_book");
    upsertApplication(SAMPLE_APPLICATION.study_id, SAMPLE_APPLICATION);
    upsertApplication(second.study_id, second);
    expect(Object.keys(loadApplications()).sort()).toEqual(
      ["study-generic-001", "study-generic-002"].sort(),
    );
    upsertApplication(SAMPLE_APPLICATION.study_id, { ...SAMPLE_APPLICATION, status: "enrolled" });
    expect(loadApplications()["study-generic-002"]).toEqual(second);
    expect(loadApplications()["study-generic-001"].status).toBe("enrolled");
  });

  it("upsertApplication forces study_id to match the map key even if the payload disagrees", () => {
    upsertApplication("study-key", { ...SAMPLE_APPLICATION, study_id: "some-other-id" });
    const map = loadApplications();
    expect(map["study-key"].study_id).toBe("study-key");
    expect(map["some-other-id"]).toBeUndefined();
  });

  it("removeApplication removes only the matching id", () => {
    upsertApplication("study-a", createApplication("study-a"));
    upsertApplication("study-b", createApplication("study-b"));
    removeApplication("study-a");
    expect(Object.keys(loadApplications())).toEqual(["study-b"]);
  });

  it("startApplication creates and persists a fresh record in one call", () => {
    const map = startApplication("study-fresh", "syndicated_external");
    expect(map["study-fresh"].channel).toBe("syndicated_external");
    expect(getApplication("study-fresh")?.status).toBe(DEFAULT_LIFECYCLE_STATUS);
  });

  it("clearApplications removes the saved map", () => {
    saveApplications({ [SAMPLE_APPLICATION.study_id]: SAMPLE_APPLICATION });
    clearApplications();
    expect(loadApplications()).toEqual({});
  });

  it("loadApplications returns {} (not a throw) for corrupted stored JSON", () => {
    localStorage.setItem("mst.applications.v1", "{not valid json");
    expect(() => loadApplications()).not.toThrow();
    expect(loadApplications()).toEqual({});
  });

  it("loadApplications sanitizes a malformed entry instead of throwing", () => {
    localStorage.setItem(
      "mst.applications.v1",
      JSON.stringify({
        "study-ok": SAMPLE_APPLICATION,
        "study-bad": { status: "not-a-real-status", channel: 42, confirmed: "nope" },
      }),
    );
    const map = loadApplications();
    expect(map["study-ok"]).toEqual({ ...SAMPLE_APPLICATION, study_id: "study-ok" });
    expect(map["study-bad"].status).toBe(DEFAULT_LIFECYCLE_STATUS);
    expect(map["study-bad"].channel).toBe(DEFAULT_APPLICATION_CHANNEL);
    expect(map["study-bad"].confirmed).toEqual({});
  });

  it("never leaves the visitor's browser: only localStorage is touched, nothing network-adjacent", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    upsertApplication(SAMPLE_APPLICATION.study_id, SAMPLE_APPLICATION);
    loadApplications();
    removeApplication(SAMPLE_APPLICATION.study_id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("application-store without localStorage available", () => {
  it("no-ops/returns defaults instead of throwing when localStorage is undefined", () => {
    // Default vitest "node" environment has no global localStorage at all —
    // this exercises that path directly, no stub needed.
    expect(() => loadApplications()).not.toThrow();
    expect(loadApplications()).toEqual({});
    expect(getApplication("study-x")).toBeUndefined();
    expect(() => saveApplications({ x: createApplication("x") })).not.toThrow();
    expect(() => clearApplications()).not.toThrow();
    expect(() => upsertApplication("x", createApplication("x"))).not.toThrow();
    expect(() => removeApplication("x")).not.toThrow();
  });
});
