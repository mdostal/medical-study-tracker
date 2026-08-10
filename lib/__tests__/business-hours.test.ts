import { describe, expect, it } from "vitest";
import { isCallableNow } from "../business-hours";

// All fixed instants below are UTC, chosen so each timezone lands somewhere
// different in its own local business-hours window -- this is exactly the
// kind of case a manual UTC-offset calculation gets wrong and
// Intl.DateTimeFormat({ timeZone }) gets right (this story's own risk
// register: DST/timezone math).

describe("isCallableNow", () => {
  it("is callable when local time is within 8am-5pm on a weekday (winter, EST)", () => {
    // Wed 2026-01-14 15:00 UTC -> 10:00am America/New_York (EST, UTC-5).
    const now = new Date("2026-01-14T15:00:00Z");
    expect(isCallableNow("America/New_York", now)).toEqual({ callable: true, known: true });
  });

  it("respects DST -- the same clinic is callable at the same UTC instant shifted by the DST offset", () => {
    // Wed 2026-07-15 13:00 UTC -> 09:00am America/New_York (EDT, UTC-4).
    const now = new Date("2026-07-15T13:00:00Z");
    expect(isCallableNow("America/New_York", now)).toEqual({ callable: true, known: true });
  });

  it("is NOT callable when it's before 8am local, even if another timezone's clinic is callable at that same instant", () => {
    // Wed 2026-01-14 15:00 UTC -> 07:00am America/Los_Angeles (PST, UTC-8) -- too early.
    const now = new Date("2026-01-14T15:00:00Z");
    expect(isCallableNow("America/Los_Angeles", now)).toEqual({ callable: false, known: true });
  });

  it("is NOT callable after 5pm local", () => {
    // Wed 2026-01-14 15:00 UTC -> 8:30pm Asia/Kolkata (UTC+5:30) -- after hours.
    const now = new Date("2026-01-14T15:00:00Z");
    expect(isCallableNow("Asia/Kolkata", now)).toEqual({ callable: false, known: true });
  });

  it("is callable right at the UTC/local coincidence for a same-offset timezone", () => {
    // Wed 2026-01-14 15:00 UTC -> 3:00pm Europe/London (UTC+0 in January).
    const now = new Date("2026-01-14T15:00:00Z");
    expect(isCallableNow("Europe/London", now)).toEqual({ callable: true, known: true });
  });

  it("is NOT callable on a weekend, even during 8am-5pm local hours", () => {
    // Sat 2026-01-17 15:00 UTC -> 10:00am America/New_York (EST) -- Saturday.
    const now = new Date("2026-01-17T15:00:00Z");
    expect(isCallableNow("America/New_York", now)).toEqual({ callable: false, known: true });
  });

  it("is exactly not-callable at the closing boundary (5:00pm local)", () => {
    // Wed 2026-01-14 22:00 UTC -> 5:00pm America/New_York (EST) -- end exclusive.
    const now = new Date("2026-01-14T22:00:00Z");
    expect(isCallableNow("America/New_York", now)).toEqual({ callable: false, known: true });
  });

  it("is callable right at the opening boundary (8:00am local)", () => {
    // Wed 2026-01-14 13:00 UTC -> 8:00am America/New_York (EST) -- start inclusive.
    const now = new Date("2026-01-14T13:00:00Z");
    expect(isCallableNow("America/New_York", now)).toEqual({ callable: true, known: true });
  });

  it("returns known:false for an unrecognized timezone string, never guessing a fallback zone", () => {
    const now = new Date("2026-01-14T15:00:00Z");
    expect(isCallableNow("Not/ARealZone", now)).toEqual({ callable: false, known: false });
  });

  it("returns known:false when tz is undefined", () => {
    const now = new Date("2026-01-14T15:00:00Z");
    expect(isCallableNow(undefined, now)).toEqual({ callable: false, known: false });
  });

  it("returns known:false for an empty-string tz", () => {
    const now = new Date("2026-01-14T15:00:00Z");
    expect(isCallableNow("", now)).toEqual({ callable: false, known: false });
  });

  it("defaults `now` to the current time when omitted", () => {
    // Just confirms it doesn't throw and returns a well-formed result shape
    // when called the way a real render call site would (no `now` arg).
    const result = isCallableNow("America/Chicago");
    expect(typeof result.callable).toBe("boolean");
    expect(typeof result.known).toBe("boolean");
  });
});
