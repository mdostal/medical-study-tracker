import { describe, expect, it } from "vitest";
import { computeBmi, DEFAULT_PROFILE } from "../types";

// story: editable-profile — nobody knows their own BMI off the top of their
// head, so components/profile-panel.tsx only ever collects height + weight;
// computeBmi is the single formula every consumer (sanitizeProfile, the
// panel's height/weight handlers) relies on to derive it.

describe("computeBmi", () => {
  it("computes the standard imperial BMI formula (703 * lb / in^2), rounded to 1 decimal", () => {
    // 5'10" (70in), 170lb -> a commonly-cited reference value (~24.4)
    expect(computeBmi(170, 70)).toBe(24.4);
    // 5'4" (64in), 150lb
    expect(computeBmi(150, 64)).toBe(25.7);
    // 6'0" (72in), 200lb
    expect(computeBmi(200, 72)).toBe(27.1);
  });

  it("matches DEFAULT_PROFILE.bmi for DEFAULT_PROFILE.height_in/weight_lb", () => {
    expect(computeBmi(DEFAULT_PROFILE.weight_lb, DEFAULT_PROFILE.height_in)).toBe(
      DEFAULT_PROFILE.bmi,
    );
  });

  it("returns 0 for a non-positive height instead of NaN/Infinity", () => {
    expect(computeBmi(170, 0)).toBe(0);
    expect(computeBmi(170, -5)).toBe(0);
    expect(Number.isFinite(computeBmi(170, 0))).toBe(true);
  });

  it("scales down BMI as height increases at a fixed weight", () => {
    expect(computeBmi(180, 66)).toBeGreaterThan(computeBmi(180, 74));
  });
});
