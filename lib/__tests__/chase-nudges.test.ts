import { describe, expect, it } from "vitest";
import {
  STALE_AFTER_BUSINESS_DAYS,
  applyStaleFlip,
  businessDaysBetween,
  byUrgencyThenStudyId,
  isCohortDeadlineAlert,
  isDoTodayNow,
  isStale,
  selectCohortDeadlineAlerts,
  selectDoTodayQueue,
  selectReCallPrompts,
} from "../chase-nudges";
import type { Application } from "../types";

// Every example value below is a generic, obviously-fictional placeholder
// (fictional-range phone number, no real name, no real biometric figure) --
// never sourced from the user's own reference chase-list artifact (this
// story's PII acceptance criterion), same convention as
// lib/__tests__/application-store.test.ts.

function makeApplication(overrides: Partial<Application> = {}): Application {
  return {
    study_id: "study-generic-001",
    channel: "call",
    status: "phone-screen",
    chase_state: "on_me",
    confirmation: { has_number: true, confirmed_in_system: true, no_email_flag: false },
    contact: { phone: "+1-555-0100", tz: "America/Chicago" },
    call_log: [],
    confirmed: {},
    ...overrides,
  };
}

// Wed 2026-01-14 15:00 UTC -> 9:00am America/Chicago (CST, UTC-6) -- within
// business hours (same fixed-instant convention as
// lib/__tests__/business-hours.test.ts).
const CALLABLE_NOW = new Date("2026-01-14T15:00:00Z");
// Wed 2026-01-14 04:00 UTC -> 10:00pm America/Chicago the prior day -- after hours.
const NOT_CALLABLE_NOW = new Date("2026-01-14T04:00:00Z");

describe("isDoTodayNow", () => {
  it("is true for chase_state=on_me, channel=call, within business hours", () => {
    const app = makeApplication({ chase_state: "on_me", channel: "call" });
    expect(isDoTodayNow(app, CALLABLE_NOW)).toBe(true);
  });

  it("is false for chase_state=on_me, channel=call, outside business hours", () => {
    const app = makeApplication({ chase_state: "on_me", channel: "call" });
    expect(isDoTodayNow(app, NOT_CALLABLE_NOW)).toBe(false);
  });

  it("is true for a self_book application even outside business hours (Self-book first rule)", () => {
    const app = makeApplication({ chase_state: "on_me", channel: "self_book" });
    expect(isDoTodayNow(app, NOT_CALLABLE_NOW)).toBe(true);
  });

  it("is false when chase_state is waiting, regardless of hours or channel", () => {
    const app = makeApplication({ chase_state: "waiting", channel: "self_book" });
    expect(isDoTodayNow(app, CALLABLE_NOW)).toBe(false);
  });

  it("is false when chase_state is stale", () => {
    const app = makeApplication({ chase_state: "stale", channel: "call" });
    expect(isDoTodayNow(app, CALLABLE_NOW)).toBe(false);
  });

  it("is false when chase_state is done", () => {
    const app = makeApplication({ chase_state: "done", channel: "self_book" });
    expect(isDoTodayNow(app, CALLABLE_NOW)).toBe(false);
  });

  it("is false for channel=call with no/unknown tz, even nominally on_me", () => {
    const app = makeApplication({ chase_state: "on_me", channel: "call", contact: {} });
    expect(isDoTodayNow(app, CALLABLE_NOW)).toBe(false);
  });

  it("is true for apply_form_fillout on_me within business hours (only self_book bypasses hours)", () => {
    const app = makeApplication({ chase_state: "on_me", channel: "apply_form_fillout" });
    expect(isDoTodayNow(app, CALLABLE_NOW)).toBe(true);
  });
});

describe("selectDoTodayQueue", () => {
  it("filters out anything not do-today-eligible and sorts urgency-first", () => {
    const apps: Application[] = [
      makeApplication({ study_id: "b-normal", chase_state: "on_me", urgency: "normal" }),
      makeApplication({ study_id: "a-now", chase_state: "on_me", urgency: "now" }),
      makeApplication({ study_id: "c-week", chase_state: "on_me", urgency: "this_week" }),
      makeApplication({ study_id: "d-waiting", chase_state: "waiting", urgency: "now" }),
      makeApplication({
        study_id: "e-not-callable",
        chase_state: "on_me",
        urgency: "now",
        contact: {},
      }),
    ];
    const queue = selectDoTodayQueue(apps, CALLABLE_NOW);
    expect(queue.map((a) => a.study_id)).toEqual(["a-now", "c-week", "b-normal"]);
  });

  it("returns an empty list when nothing qualifies", () => {
    const apps: Application[] = [makeApplication({ chase_state: "waiting" })];
    expect(selectDoTodayQueue(apps, CALLABLE_NOW)).toEqual([]);
  });
});

describe("byUrgencyThenStudyId", () => {
  it("breaks urgency ties by study_id ascending", () => {
    const a = { study_id: "z", urgency: "now" as const };
    const b = { study_id: "a", urgency: "now" as const };
    expect(byUrgencyThenStudyId(a, b)).toBeGreaterThan(0);
    expect(byUrgencyThenStudyId(b, a)).toBeLessThan(0);
  });

  it("treats an unset urgency the same as normal", () => {
    const withUndefined = { study_id: "x", urgency: undefined };
    const normal = { study_id: "x", urgency: "normal" as const };
    expect(byUrgencyThenStudyId(withUndefined, normal)).toBe(0);
  });
});

describe("isCohortDeadlineAlert", () => {
  it("is true when urgency=now and next_action_due is a parseable date", () => {
    const app = makeApplication({ urgency: "now", next_action_due: "2026-01-20" });
    expect(isCohortDeadlineAlert(app)).toBe(true);
  });

  it("is false when urgency=now but no next_action_due is set", () => {
    const app = makeApplication({ urgency: "now" });
    expect(isCohortDeadlineAlert(app)).toBe(false);
  });

  it("is false when next_action_due is set but urgency is only this_week", () => {
    const app = makeApplication({ urgency: "this_week", next_action_due: "2026-01-20" });
    expect(isCohortDeadlineAlert(app)).toBe(false);
  });

  it("is false when next_action_due is set but urgency is normal", () => {
    const app = makeApplication({ urgency: "normal", next_action_due: "2026-01-20" });
    expect(isCohortDeadlineAlert(app)).toBe(false);
  });

  it("is false when next_action_due is unparseable", () => {
    const app = makeApplication({ urgency: "now", next_action_due: "not-a-date" });
    expect(isCohortDeadlineAlert(app)).toBe(false);
  });
});

describe("selectCohortDeadlineAlerts", () => {
  it("returns only urgency=now-with-due-date entries, urgency/id sorted", () => {
    const apps: Application[] = [
      makeApplication({ study_id: "b", urgency: "now", next_action_due: "2026-02-01" }),
      makeApplication({ study_id: "a", urgency: "now", next_action_due: "2026-02-01" }),
      makeApplication({ study_id: "c", urgency: "this_week", next_action_due: "2026-02-01" }),
      makeApplication({ study_id: "d", urgency: "now" }),
    ];
    expect(selectCohortDeadlineAlerts(apps).map((a) => a.study_id)).toEqual(["a", "b"]);
  });
});

describe("businessDaysBetween", () => {
  it("counts weekdays only, skipping a weekend in between", () => {
    // Wed 2026-01-14 -> Wed 2026-01-21: Thu, Fri, (skip Sat/Sun), Mon, Tue, Wed = 5 weekdays.
    const from = new Date("2026-01-14T12:00:00Z");
    const to = new Date("2026-01-21T12:00:00Z");
    expect(businessDaysBetween(from, to)).toBe(5);
  });

  it("returns 0 for the same calendar day", () => {
    const d = new Date("2026-01-14T09:00:00Z");
    expect(businessDaysBetween(d, d)).toBe(0);
  });

  it("returns 0 (never negative) when to is before from", () => {
    const from = new Date("2026-01-14T09:00:00Z");
    const to = new Date("2026-01-10T09:00:00Z");
    expect(businessDaysBetween(from, to)).toBe(0);
  });

  it("counts a pure weekday span with no weekend crossed", () => {
    // Mon 2026-01-12 -> Wed 2026-01-14 = Tue, Wed = 2 weekdays.
    const from = new Date("2026-01-12T09:00:00Z");
    const to = new Date("2026-01-14T09:00:00Z");
    expect(businessDaysBetween(from, to)).toBe(2);
  });

  it("does not count a Sat-to-Mon span since no weekday boundary is crossed", () => {
    const from = new Date("2026-01-17T09:00:00Z"); // Saturday
    const to = new Date("2026-01-18T09:00:00Z"); // Sunday
    expect(businessDaysBetween(from, to)).toBe(0);
  });
});

describe("isStale", () => {
  it("is false when chase_state is not waiting, no matter how old the last movement", () => {
    const app = makeApplication({
      chase_state: "on_me",
      applied_date: "2025-01-01",
    });
    expect(isStale(app, new Date("2026-01-14T12:00:00Z"))).toBe(false);
  });

  it("is false when the most recent call_log entry is within the threshold", () => {
    const app = makeApplication({
      chase_state: "waiting",
      applied_date: "2025-01-01",
      call_log: [{ date: "2026-01-13", who: "clinic coordinator", summary: "Left a voicemail." }],
    });
    // 2026-01-14 is 1 business day after 2026-01-13.
    expect(isStale(app, new Date("2026-01-14T12:00:00Z"))).toBe(false);
  });

  it(`is true once ${STALE_AFTER_BUSINESS_DAYS} business days have passed with no movement`, () => {
    const app = makeApplication({
      chase_state: "waiting",
      call_log: [{ date: "2026-01-05", who: "clinic coordinator", summary: "Applied, awaiting reply." }],
    });
    // 2026-01-05 (Mon) -> 2026-01-13 (Tue) = 6 business days.
    expect(isStale(app, new Date("2026-01-13T12:00:00Z"))).toBe(true);
  });

  it("falls back to applied_date when call_log is empty", () => {
    const app = makeApplication({
      chase_state: "waiting",
      applied_date: "2026-01-05",
      call_log: [],
    });
    expect(isStale(app, new Date("2026-01-13T12:00:00Z"))).toBe(true);
  });

  it("uses the LATEST of call_log entries / applied_date, not applied_date alone", () => {
    const app = makeApplication({
      chase_state: "waiting",
      applied_date: "2025-01-01", // long ago
      call_log: [{ date: "2026-01-13", who: "clinic coordinator", summary: "Just spoke, waiting on cohort dates." }],
    });
    // Most recent movement is 2026-01-13, only 1 business day before "now".
    expect(isStale(app, new Date("2026-01-14T12:00:00Z"))).toBe(false);
  });

  it("is false (not stale) when there is no date at all to judge from", () => {
    const app = makeApplication({ chase_state: "waiting", call_log: [] });
    expect(isStale(app, new Date("2026-01-14T12:00:00Z"))).toBe(false);
  });
});

describe("applyStaleFlip", () => {
  it("flips only waiting applications past the threshold, leaving others untouched by reference", () => {
    const staleCandidate = makeApplication({
      study_id: "study-stale",
      chase_state: "waiting",
      call_log: [{ date: "2026-01-05", who: "clinic coordinator", summary: "Applied, awaiting reply." }],
    });
    const freshWaiting = makeApplication({
      study_id: "study-fresh",
      chase_state: "waiting",
      call_log: [{ date: "2026-01-13", who: "clinic coordinator", summary: "Just spoke." }],
    });
    const onMe = makeApplication({ study_id: "study-on-me", chase_state: "on_me" });

    const input = {
      [staleCandidate.study_id]: staleCandidate,
      [freshWaiting.study_id]: freshWaiting,
      [onMe.study_id]: onMe,
    };

    const result = applyStaleFlip(input, new Date("2026-01-13T12:00:00Z"));

    expect(result.flippedIds).toEqual(["study-stale"]);
    expect(result.applications["study-stale"].chase_state).toBe("stale");
    // Untouched entries keep the exact same object reference.
    expect(result.applications["study-fresh"]).toBe(freshWaiting);
    expect(result.applications["study-on-me"]).toBe(onMe);
  });

  it("returns an empty flippedIds list and no-op map when nothing is stale", () => {
    const app = makeApplication({ study_id: "study-x", chase_state: "on_me" });
    const result = applyStaleFlip({ [app.study_id]: app }, new Date("2026-01-14T12:00:00Z"));
    expect(result.flippedIds).toEqual([]);
    expect(result.applications["study-x"]).toBe(app);
  });

  it("does not mutate the input map or its entries", () => {
    const staleCandidate = makeApplication({
      study_id: "study-stale",
      chase_state: "waiting",
      call_log: [{ date: "2026-01-05", who: "clinic coordinator", summary: "Applied, awaiting reply." }],
    });
    const input = { [staleCandidate.study_id]: staleCandidate };
    applyStaleFlip(input, new Date("2026-01-13T12:00:00Z"));
    expect(input["study-stale"].chase_state).toBe("waiting");
  });
});

describe("selectReCallPrompts", () => {
  it("returns only chase_state=stale entries, urgency/id sorted", () => {
    const apps: Application[] = [
      makeApplication({ study_id: "b", chase_state: "stale", urgency: "normal" }),
      makeApplication({ study_id: "a", chase_state: "stale", urgency: "now" }),
      makeApplication({ study_id: "c", chase_state: "waiting" }),
      makeApplication({ study_id: "d", chase_state: "on_me" }),
    ];
    expect(selectReCallPrompts(apps).map((a) => a.study_id)).toEqual(["a", "b"]);
  });

  it("returns an empty list when nothing is stale", () => {
    const apps: Application[] = [makeApplication({ chase_state: "on_me" })];
    expect(selectReCallPrompts(apps)).toEqual([]);
  });
});
