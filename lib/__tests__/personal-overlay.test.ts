import { describe, expect, it } from "vitest";
import { scoreOne } from "../scoring";
import { createApplication, DEFAULT_ASSUMPTIONS, sanitizeApplication } from "../types";
import type { Application, Assumptions, FriendMap, Profile, Study } from "../types";
import {
  applyPersonalOverlay,
  buildCallLogUpdate,
  distributeNights,
  parseCallLogFormInputs,
  shareableCallLogFields,
  type CallLogFormInputs,
} from "../personal-overlay";

// story: call-log-writeback
//
// Every example value below is a generic, made-up placeholder (fictional
// study id, generic role label like "clinic coordinator", round numbers) --
// never sourced from the shared reference chase-list artifact and never a
// real name, phone number, or biometric figure.

const BASE_STUDY: Study = {
  id: "TEST-STUDY-1",
  network: "Example Network",
  city: "Example City",
  state: "TX",
  hub: "SA",
  pay_gross: 10000,
  currency: "USD",
  payout: { type: "unknown", settle_days: null },
  stays: null, // unknown -> scoring.ts estimates + flags "nights unknown — confirm on call"
  visits: 1,
  bmi_min: null,
  bmi_max: null, // both null -> scoring.ts flags "confirm BMI on call"
  age_min: 18,
  age_max: 55,
  sex: "M/F",
  smoker: "non",
  special_pop: null,
};

const PROFILE: Profile = { bmi: 24, height_in: 70, weight_lb: 180, weight_swing_lb: 0, sex: "male", age: 32 };
const ASSUMPTIONS: Assumptions = DEFAULT_ASSUMPTIONS;
const FRIEND_MAP: FriendMap = { hubs: {}, backup_care_available: {} };

function confirmedApplication(overrides: Partial<Application> = {}): Application {
  return sanitizeApplication(
    {
      channel: "call",
      confirmed: { nights: [4, 4], bmi_ok: true },
      payout: { type: "lump_end", settle_days: 45 },
      washout_days: 30,
      stipend_per_visit: 50,
      ...overrides,
    },
    BASE_STUDY.id,
  );
}

describe("applyPersonalOverlay", () => {
  it("is a no-op passthrough when no applications map is given", () => {
    const [out] = applyPersonalOverlay([BASE_STUDY], undefined);
    expect(out).toEqual(BASE_STUDY);
    expect(out).not.toBe(BASE_STUDY); // never mutates/returns the same reference
  });

  it("is a no-op passthrough for a visitor who never logged a call for this study", () => {
    const [out] = applyPersonalOverlay([BASE_STUDY], {});
    expect(out).toEqual(BASE_STUDY);
  });

  it("is a no-op passthrough for an Application with no confirmed data yet (e.g. just started, never called)", () => {
    const fresh = createApplication(BASE_STUDY.id, "call");
    const [out] = applyPersonalOverlay([BASE_STUDY], { [BASE_STUDY.id]: fresh });
    expect(out.stays).toBeNull();
    expect(out.payout).toEqual(BASE_STUDY.payout);
    expect(out.bmi_min).toBeNull();
    expect(out.bmi_max).toBeNull();
  });

  it("overrides stays from confirmed.nights", () => {
    const app = confirmedApplication();
    const [out] = applyPersonalOverlay([BASE_STUDY], { [BASE_STUDY.id]: app });
    expect(out.stays).toEqual([4, 4]);
  });

  it("overrides payout type + settle_days from Application.payout", () => {
    const app = confirmedApplication();
    const [out] = applyPersonalOverlay([BASE_STUDY], { [BASE_STUDY.id]: app });
    expect(out.payout).toEqual({ type: "lump_end", settle_days: 45 });
  });

  it("overrides washout_days and travel_stipend_per_visit", () => {
    const app = confirmedApplication();
    const [out] = applyPersonalOverlay([BASE_STUDY], { [BASE_STUDY.id]: app });
    expect(out.washout_days).toBe(30);
    expect(out.travel_stipend_per_visit).toBe(50);
  });

  it("widens bmi_min/bmi_max only when the base range is fully unknown AND bmi_ok is confirmed true", () => {
    const app = confirmedApplication();
    const [out] = applyPersonalOverlay([BASE_STUDY], { [BASE_STUDY.id]: app });
    expect(out.bmi_min).not.toBeNull();
    expect(out.bmi_max).not.toBeNull();
    // Never actually tightens/narrows eligibility for a normal profile BMI.
    expect(PROFILE.bmi).toBeGreaterThanOrEqual(out.bmi_min!);
    expect(PROFILE.bmi).toBeLessThanOrEqual(out.bmi_max!);
  });

  it("never overrides bmi_min/bmi_max when the seed already has a real range, even if bmi_ok is confirmed", () => {
    const withRange: Study = { ...BASE_STUDY, bmi_min: 18, bmi_max: 30 };
    const app = confirmedApplication();
    const [out] = applyPersonalOverlay([withRange], { [BASE_STUDY.id]: app });
    expect(out.bmi_min).toBe(18);
    expect(out.bmi_max).toBe(30);
  });

  it("does not override bmi bounds when bmi_ok was never confirmed (undefined)", () => {
    const app = confirmedApplication({ confirmed: { nights: [8] } });
    const [out] = applyPersonalOverlay([BASE_STUDY], { [BASE_STUDY.id]: app });
    expect(out.bmi_min).toBeNull();
    expect(out.bmi_max).toBeNull();
  });

  it("never mutates the input Study or Application objects", () => {
    const app = confirmedApplication();
    const studyBefore = JSON.parse(JSON.stringify(BASE_STUDY));
    const appBefore = JSON.parse(JSON.stringify(app));
    applyPersonalOverlay([BASE_STUDY], { [BASE_STUDY.id]: app });
    expect(BASE_STUDY).toEqual(studyBefore);
    expect(app).toEqual(appBefore);
  });

  it("only overrides the one study a call was logged for, leaving every other study untouched", () => {
    const other: Study = { ...BASE_STUDY, id: "TEST-STUDY-2" };
    const app = confirmedApplication();
    const [confirmed, untouched] = applyPersonalOverlay([BASE_STUDY, other], {
      [BASE_STUDY.id]: app,
    });
    expect(confirmed.stays).toEqual([4, 4]);
    expect(untouched.stays).toBeNull();
  });
});

describe("applyPersonalOverlay -> scoreOne (the actual write-back into the ranking)", () => {
  it("clears 'nights unknown' and 'payout timing unknown' and 'confirm BMI on call' once confirmed, and changes the real computed numbers", () => {
    const before = scoreOne(BASE_STUDY, PROFILE, ASSUMPTIONS, FRIEND_MAP);
    expect(before.nights_estimated).toBe(true);
    expect(before.payout_unconfirmed).toBe(true);
    expect(before.flags).toContain("nights unknown — confirm on call");
    expect(before.flags).toContain("payout timing unknown — ASK how/when they pay");
    expect(before.flags).toContain("confirm BMI on call");

    const app = confirmedApplication();
    const [overridden] = applyPersonalOverlay([BASE_STUDY], { [BASE_STUDY.id]: app });
    const after = scoreOne(overridden, PROFILE, ASSUMPTIONS, FRIEND_MAP);

    expect(after.nights_estimated).toBe(false);
    expect(after.payout_unconfirmed).toBe(false);
    expect(after.inpatient_nights).toBe(8); // 4 + 4, the visitor's real confirmed total
    expect(after.settle_days).toBe(45);
    expect(after.flags).not.toContain("nights unknown — confirm on call");
    expect(after.flags).not.toContain("payout timing unknown — ASK how/when they pay");
    expect(after.flags).not.toContain("confirm BMI on call");

    // The estimate-based numbers actually changed, not just the flags —
    // this is the "write-back into the ranking, not just storage" AC.
    expect(after.cash_velocity).not.toBe(before.cash_velocity);
  });

  it("a visitor who never logs a call sees zero behavior change", () => {
    const direct = scoreOne(BASE_STUDY, PROFILE, ASSUMPTIONS, FRIEND_MAP);
    const [overridden] = applyPersonalOverlay([BASE_STUDY], {});
    const viaOverlay = scoreOne(overridden, PROFILE, ASSUMPTIONS, FRIEND_MAP);
    expect(viaOverlay).toEqual(direct);
  });
});

describe("distributeNights", () => {
  it("splits an evenly-divisible total across stays", () => {
    expect(distributeNights(8, 2)).toEqual([4, 4]);
  });

  it("distributes the remainder to the first stays rather than dropping it", () => {
    const result = distributeNights(10, 3);
    expect(result.reduce((a, b) => a + b, 0)).toBe(10);
    expect(result).toEqual([4, 3, 3]);
  });

  it("defaults to a single stay when stayCount is 0/invalid", () => {
    expect(distributeNights(8, 0)).toEqual([8]);
  });
});

describe("buildCallLogUpdate", () => {
  it("appends one CallEntry to call_log and populates confirmed/payout/washout_days/stipend_per_visit", () => {
    const start = createApplication("TEST-STUDY-1");
    const updated = buildCallLogUpdate(start, {
      date: "2026-08-09",
      who: "clinic coordinator",
      summary: "went over the 5 questions",
      totalNights: 8,
      stayCount: 2,
      payoutType: "lump_end",
      settleDays: 45,
      washoutDays: 30,
      bmiOk: true,
      stipendPerVisit: 50,
    });

    expect(updated.call_log).toEqual([
      { date: "2026-08-09", who: "clinic coordinator", summary: "went over the 5 questions" },
    ]);
    expect(updated.confirmed.nights).toEqual([4, 4]);
    expect(updated.confirmed.bmi_ok).toBe(true);
    expect(updated.payout).toEqual({ type: "lump_end", settle_days: 45 });
    expect(updated.washout_days).toBe(30);
    expect(updated.stipend_per_visit).toBe(50);
  });

  it("never mutates the input Application", () => {
    const start = createApplication("TEST-STUDY-1");
    const before = JSON.parse(JSON.stringify(start));
    buildCallLogUpdate(start, { date: "2026-08-09", who: "coordinator", summary: "call" });
    expect(start).toEqual(before);
  });

  it("leaves an unanswered question's previously-confirmed value untouched", () => {
    const withNights = buildCallLogUpdate(createApplication("TEST-STUDY-1"), {
      date: "2026-08-01",
      who: "coordinator",
      summary: "first call",
      totalNights: 8,
      stayCount: 1,
    });
    const secondCall = buildCallLogUpdate(withNights, {
      date: "2026-08-08",
      who: "coordinator",
      summary: "follow-up, only asked about payout this time",
      settleDays: 45,
      payoutType: "prorated",
    });
    expect(secondCall.confirmed.nights).toEqual([8]); // untouched by the second call
    expect(secondCall.payout).toEqual({ type: "prorated", settle_days: 45 });
    expect(secondCall.call_log).toHaveLength(2);
  });

  it("appends a second call's entry on top of the first rather than replacing it", () => {
    const first = buildCallLogUpdate(createApplication("TEST-STUDY-1"), {
      date: "2026-08-01",
      who: "coordinator",
      summary: "first call",
    });
    const second = buildCallLogUpdate(first, {
      date: "2026-08-08",
      who: "coordinator",
      summary: "second call",
    });
    expect(second.call_log.map((c) => c.summary)).toEqual(["first call", "second call"]);
  });
});

describe("parseCallLogFormInputs", () => {
  const blankInputs: CallLogFormInputs = {
    date: "2026-08-09",
    who: "  clinic coordinator  ",
    summary: "  covered all 5 questions  ",
    totalNights: "",
    stayCount: "",
    payoutType: "unknown",
    settleDays: "",
    payoutNote: "",
    washoutDays: "",
    bmiOk: "unset",
    stipendPerVisit: "",
  };

  it("trims who/summary and skips every unanswered numeric question", () => {
    const answers = parseCallLogFormInputs(blankInputs);
    expect(answers.who).toBe("clinic coordinator");
    expect(answers.summary).toBe("covered all 5 questions");
    expect(answers.totalNights).toBeUndefined();
    expect(answers.settleDays).toBeUndefined();
    expect(answers.washoutDays).toBeUndefined();
    expect(answers.bmiOk).toBeUndefined();
    expect(answers.stipendPerVisit).toBeUndefined();
  });

  it("parses all 5 questions when every field is answered", () => {
    const answers = parseCallLogFormInputs({
      ...blankInputs,
      totalNights: "8",
      stayCount: "2",
      payoutType: "lump_end",
      settleDays: "45",
      payoutNote: "after last visit",
      washoutDays: "30",
      bmiOk: "yes",
      stipendPerVisit: "50",
    });
    expect(answers.totalNights).toBe(8);
    expect(answers.stayCount).toBe(2);
    expect(answers.payoutType).toBe("lump_end");
    expect(answers.settleDays).toBe(45);
    expect(answers.payoutNote).toBe("after last visit");
    expect(answers.washoutDays).toBe(30);
    expect(answers.bmiOk).toBe(true);
    expect(answers.stipendPerVisit).toBe(50);
  });

  it("treats garbage numeric input as unanswered rather than throwing or coercing to 0", () => {
    const answers = parseCallLogFormInputs({ ...blankInputs, totalNights: "not a number" });
    expect(answers.totalNights).toBeUndefined();
  });

  it("maps bmiOk 'no' to a defined false (distinct from 'unset' -> undefined)", () => {
    const answers = parseCallLogFormInputs({ ...blankInputs, bmiOk: "no" });
    expect(answers.bmiOk).toBe(false);
  });
});

describe("shareableCallLogFields (the opt-in community-correction bridge)", () => {
  it("offers nothing to share for an Application with no confirmed data", () => {
    expect(shareableCallLogFields(createApplication("TEST-STUDY-1"))).toEqual([]);
  });

  it("offers 'stays' and 'payout.settle_days' once both are confirmed, with the exact canonical values", () => {
    const app = confirmedApplication();
    const shareable = shareableCallLogFields(app);
    expect(shareable).toEqual([
      { field: "stays", value: "8", label: "confirmed nights" },
      { field: "payout.settle_days", value: "45", label: "confirmed payout timing" },
    ]);
  });

  it("does not offer washout/BMI/stipend to share -- no matching CorrectionFieldId exists for them", () => {
    const app = confirmedApplication();
    const fields = shareableCallLogFields(app).map((f) => f.field);
    expect(fields).not.toContain("washout_days");
    expect(fields).not.toContain("bmi_ok");
    expect(fields).not.toContain("stipend_per_visit");
  });

  it("offers only 'stays' when payout hasn't been confirmed yet", () => {
    const app = confirmedApplication({ payout: undefined });
    expect(shareableCallLogFields(app)).toEqual([
      { field: "stays", value: "8", label: "confirmed nights" },
    ]);
  });
});
