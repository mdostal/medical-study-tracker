// "Is this clinic callable right now?" — docs/APPLICATION-TRACKING.md "Core
// truths": "Recruiting runs business hours. Phone-screens/scheduling are
// ~8-5 Mon-Fri local time." Framework-free (no React/Next.js imports),
// matching lib/scoring.ts's / lib/local-status-store.ts's own convention —
// pure function of (tz, now) so it's fully unit-testable without faking the
// system clock (the caller passes `new Date()` at render time).
//
// Uses Intl.DateTimeFormat with an explicit `timeZone` to derive the LOCAL
// weekday/hour in that timezone, rather than manual UTC-offset arithmetic
// (this story's own risk register: DST/timezone math is a classic source of
// subtle bugs — Intl's IANA tz database handles DST transitions correctly
// where a fixed offset would not). Never hardcoded to any single timezone
// (this story's explicit acceptance criterion) — every study's own
// contact.tz drives its own result.

const BUSINESS_START_HOUR = 8; // 8am local to the clinic
const BUSINESS_END_HOUR = 17; // 5pm local to the clinic
const BUSINESS_DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

export interface BusinessHoursResult {
  /** True only when tz is known/valid AND the local time is within business hours. */
  callable: boolean;
  /**
   * False means tz was missing/unrecognized, so `callable: false` is a
   * conservative "we don't know" fallback, not a real "closed right now"
   * answer — lets the UI distinguish the two cases instead of silently
   * treating an unset timezone as one particular zone.
   */
  known: boolean;
}

function isValidTimeZone(tz: string): boolean {
  try {
    // Throws a RangeError for an unrecognized IANA zone name.
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Is a clinic in timezone `tz` callable right now (~8am-5pm Mon-Fri, LOCAL
 * to that clinic)? `now` defaults to the real current time but is
 * injectable for tests. Returns `{ callable: false, known: false }` for a
 * missing or unrecognized tz — never guesses/defaults to any single
 * timezone.
 */
export function isCallableNow(
  tz: string | undefined,
  now: Date = new Date(),
): BusinessHoursResult {
  if (!tz || !isValidTimeZone(tz)) return { callable: false, known: false };

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "";
  // Some ICU implementations render local midnight as "24" rather than "0"
  // with hour12:false — normalize so the range check below is correct
  // either way.
  let hour = parseInt(hourPart, 10);
  if (hour === 24) hour = 0;
  if (!Number.isFinite(hour)) return { callable: false, known: false };

  const callable =
    BUSINESS_DAYS.has(weekday) && hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;
  return { callable, known: true };
}
