import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPLICATION_CHANNEL,
  DEFAULT_CHASE_STATE,
  DEFAULT_LIFECYCLE_STATUS,
  LIFECYCLE_PIPELINE,
  TERMINAL_LIFECYCLE_STATUSES,
  sanitizeApplication,
  sanitizeApplicationsMap,
  type Application,
} from "../types";

// Pure-validator tests for lib/types.ts's Application sanitizers — the same
// "malformed input never throws, falls back to defaults" contract
// sanitizePersistedState already provides for Profile (see
// lib/__tests__/persisted-state.test.ts), applied to the
// application-data-model-and-persistence story's Application record.
//
// Every example value below is a generic placeholder (fictional-range phone
// number, no real name, no real biometric figure) — never sourced from the
// shared reference artifact.

describe("lifecycle pipeline shape", () => {
  it("matches docs/APPLICATION-TRACKING.md's pipeline exactly", () => {
    expect(LIFECYCLE_PIPELINE).toEqual([
      ["identified"],
      ["applied", "booked"],
      ["phone-screen"],
      ["screening-scheduled"],
      ["screened"],
      ["qualified", "offered"],
      ["enrolled"],
      ["dosing"],
      ["paid"],
    ]);
  });

  it("exposes the four terminal off-ramps reachable from any point", () => {
    expect(TERMINAL_LIFECYCLE_STATUSES).toEqual([
      "not-eligible",
      "declined",
      "cohort-full",
      "closed",
    ]);
  });

  it("accepts a terminal status regardless of the record's current pipeline stage (no enforced transition graph)", () => {
    const fromEarly = sanitizeApplication({ status: "identified" }, "s1");
    const fromLate = sanitizeApplication({ status: "dosing" }, "s1");
    for (const start of [fromEarly, fromLate]) {
      for (const terminal of TERMINAL_LIFECYCLE_STATUSES) {
        const next = sanitizeApplication({ ...start, status: terminal }, "s1");
        expect(next.status).toBe(terminal);
      }
    }
  });
});

describe("sanitizeApplication", () => {
  it("returns full defaults for undefined/null/garbage input, always forcing study_id from the argument", () => {
    for (const garbage of [undefined, null, "not an object", 42, []]) {
      const app = sanitizeApplication(garbage, "study-1");
      expect(app).toEqual({
        study_id: "study-1",
        channel: DEFAULT_APPLICATION_CHANNEL,
        status: DEFAULT_LIFECYCLE_STATUS,
        chase_state: DEFAULT_CHASE_STATE,
        confirmation: { has_number: false, confirmed_in_system: false, no_email_flag: false },
        contact: {},
        call_log: [],
        confirmed: {},
      });
    }
  });

  it("round-trips a fully valid Application unchanged", () => {
    const valid: Application = {
      study_id: "study-2",
      channel: "self_book",
      status: "screening-scheduled",
      chase_state: "on_me",
      applied_date: "2026-03-01",
      confirmation: { has_number: true, confirmed_in_system: true, no_email_flag: false, ref: "ABC123" },
      contact: { phone: "+1-555-0142", scheduler_url: "https://example-clinic.test/book", tz: "America/New_York" },
      next_action: "self-book screening",
      next_action_due: "2026-03-10",
      urgency: "now",
      call_log: [{ date: "2026-03-01", who: "clinic coordinator", summary: "Booked screening slot." }],
      screening_date: "2026-03-12",
      cohort_dates: ["2026-04-01"],
      confirmed: { nights: [2], visits: 1, bmi_ok: true },
      payout: { type: "prorated", settle_days: 7 },
      washout_days: 14,
      stipend_per_visit: 40,
      notes: "Generic placeholder note.",
    };
    expect(sanitizeApplication(valid, "study-2")).toEqual(valid);
  });

  it("overrides an embedded study_id with the studyId argument", () => {
    const app = sanitizeApplication({ study_id: "wrong-id", channel: "call" }, "right-id");
    expect(app.study_id).toBe("right-id");
  });

  it("falls back per-field for an invalid enum value while keeping the rest", () => {
    const app = sanitizeApplication(
      { channel: "carrier_pigeon", status: "in-orbit", chase_state: "asleep", urgency: "eventually" },
      "study-3",
    );
    expect(app.channel).toBe(DEFAULT_APPLICATION_CHANNEL);
    expect(app.status).toBe(DEFAULT_LIFECYCLE_STATUS);
    expect(app.chase_state).toBe(DEFAULT_CHASE_STATE);
    expect(app.urgency).toBeUndefined();
  });

  it("drops non-string optional string fields instead of throwing", () => {
    const app = sanitizeApplication(
      { applied_date: 12345, next_action: {}, next_action_due: [], screening_date: false, notes: 0 },
      "study-4",
    );
    expect(app.applied_date).toBeUndefined();
    expect(app.next_action).toBeUndefined();
    expect(app.next_action_due).toBeUndefined();
    expect(app.screening_date).toBeUndefined();
    expect(app.notes).toBeUndefined();
  });

  it("sanitizes confirmation sub-object field-by-field", () => {
    const app = sanitizeApplication(
      { confirmation: { has_number: "yes", confirmed_in_system: true, no_email_flag: 1, ref: 42 } },
      "study-5",
    );
    expect(app.confirmation).toEqual({
      has_number: false,
      confirmed_in_system: true,
      no_email_flag: false,
    });
  });

  it("sanitizes contact sub-object, dropping malformed fields", () => {
    const app = sanitizeApplication({ contact: { phone: 5551234, scheduler_url: "https://ok.test", tz: 9 } }, "study-6");
    expect(app.contact).toEqual({ scheduler_url: "https://ok.test" });
  });

  it("drops non-CallEntry items from call_log instead of throwing", () => {
    const app = sanitizeApplication(
      {
        call_log: [
          { date: "2026-01-01", who: "coordinator", summary: "ok entry" },
          { date: "2026-01-02", who: "coordinator" }, // missing summary
          "not an object",
          42,
        ],
      },
      "study-7",
    );
    expect(app.call_log).toEqual([{ date: "2026-01-01", who: "coordinator", summary: "ok entry" }]);
  });

  it("sanitizes confirmed-on-call fields, rejecting a nights array with a non-number entry", () => {
    const app = sanitizeApplication(
      { confirmed: { nights: [2, "three"], visits: "two", bmi_ok: "yes" } },
      "study-8",
    );
    expect(app.confirmed).toEqual({});
  });

  it("keeps a valid confirmed-on-call payload", () => {
    const app = sanitizeApplication({ confirmed: { nights: [1, 2, 3], visits: 4, bmi_ok: false } }, "study-9");
    expect(app.confirmed).toEqual({ nights: [1, 2, 3], visits: 4, bmi_ok: false });
  });

  it("rejects a payout with an invalid type instead of trusting it", () => {
    const app = sanitizeApplication({ payout: { type: "cash_under_the_table", settle_days: 3 } }, "study-10");
    expect(app.payout).toBeUndefined();
  });

  it("keeps a valid payout and defaults a missing/non-finite settle_days to null", () => {
    const app = sanitizeApplication({ payout: { type: "milestone" } }, "study-11");
    expect(app.payout).toEqual({ type: "milestone", settle_days: null });
  });

  it("accepts explicit null for washout_days/stipend_per_visit (meaning 'known unknown')", () => {
    const app = sanitizeApplication({ washout_days: null, stipend_per_visit: null }, "study-12");
    expect(app.washout_days).toBeNull();
    expect(app.stipend_per_visit).toBeNull();
  });

  it("rejects non-finite numbers (NaN/Infinity) for washout_days/stipend_per_visit", () => {
    const app = sanitizeApplication({ washout_days: NaN, stipend_per_visit: Infinity }, "study-13");
    expect(app.washout_days).toBeUndefined();
    expect(app.stipend_per_visit).toBeUndefined();
  });

  it("never throws regardless of input shape", () => {
    const inputs: unknown[] = [
      undefined,
      null,
      42,
      "x",
      [],
      {},
      { call_log: null },
      { confirmed: null },
      { contact: null },
      { confirmation: null },
      { payout: "not an object" },
      { cohort_dates: "not an array" },
    ];
    for (const input of inputs) {
      expect(() => sanitizeApplication(input, "study-x")).not.toThrow();
    }
  });
});

describe("sanitizeApplicationsMap", () => {
  it("returns {} for non-object/array/null input", () => {
    for (const garbage of [undefined, null, "not an object", 42, [1, 2, 3]]) {
      expect(sanitizeApplicationsMap(garbage)).toEqual({});
    }
  });

  it("sanitizes each entry, forcing its study_id to match its own map key", () => {
    const map = sanitizeApplicationsMap({
      "study-a": { channel: "call", study_id: "study-b" },
      "study-b": { channel: "self_book" },
    });
    expect(map["study-a"].study_id).toBe("study-a");
    expect(map["study-a"].channel).toBe("call");
    expect(map["study-b"].study_id).toBe("study-b");
    expect(map["study-b"].channel).toBe("self_book");
  });

  it("drops entries with a non-string or empty key", () => {
    const map = sanitizeApplicationsMap({ "": { channel: "call" }, "study-ok": { channel: "call" } });
    expect(Object.keys(map)).toEqual(["study-ok"]);
  });

  it("never throws regardless of input shape", () => {
    for (const input of [undefined, null, "x", 42, [], { a: null }, { a: "not an object" }]) {
      expect(() => sanitizeApplicationsMap(input)).not.toThrow();
    }
  });
});
