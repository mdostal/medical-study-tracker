import { describe, expect, it } from "vitest";
import {
  CORRECTION_FIELDS,
  EMPTY_COMMUNITY_FILE,
  formatCorrectionValue,
  getFieldConsensus,
  getStudyCorrections,
  isCorrectionFieldId,
  mergeCommunityOverlay,
  normalizeCorrectionValue,
  sanitizeCommunityCorrectionsFile,
  type CommunityCorrectionsFile,
  type CommunityFieldConsensus,
} from "../community-overlay";

describe("normalizeCorrectionValue", () => {
  it("canonicalizes whole-number fields", () => {
    expect(normalizeCorrectionValue("payout.settle_days", " 45 ")).toBe("45");
    expect(normalizeCorrectionValue("stays", "10")).toBe("10");
  });

  it("rejects non-numeric, negative, or absurd values for whole-number fields", () => {
    expect(normalizeCorrectionValue("payout.settle_days", "forty-five")).toBeNull();
    expect(normalizeCorrectionValue("payout.settle_days", "-5")).toBeNull();
    expect(normalizeCorrectionValue("stays", "99999")).toBeNull();
    expect(normalizeCorrectionValue("stays", "")).toBeNull();
    expect(normalizeCorrectionValue("stays", "   ")).toBeNull();
  });

  it("canonicalizes a BMI range regardless of separator spacing", () => {
    expect(normalizeCorrectionValue("bmi_range", "18-30")).toBe("18-30");
    expect(normalizeCorrectionValue("bmi_range", "18 - 30")).toBe("18-30");
    expect(normalizeCorrectionValue("bmi_range", "18 to 30")).toBe("18-30");
  });

  it("rejects an inverted, malformed, or out-of-range BMI range", () => {
    expect(normalizeCorrectionValue("bmi_range", "30-18")).toBeNull();
    expect(normalizeCorrectionValue("bmi_range", "not a range")).toBeNull();
    expect(normalizeCorrectionValue("bmi_range", "18")).toBeNull();
    expect(normalizeCorrectionValue("bmi_range", "0-30")).toBeNull();
    expect(normalizeCorrectionValue("bmi_range", "18-500")).toBeNull();
  });
});

describe("formatCorrectionValue / isCorrectionFieldId / fieldLabel", () => {
  it("formats each field's canonical value for display", () => {
    expect(formatCorrectionValue("payout.settle_days", "45")).toBe("45d");
    expect(formatCorrectionValue("stays", "10")).toBe("10 nights");
    expect(formatCorrectionValue("bmi_range", "18-30")).toBe("BMI 18-30");
  });

  it("recognizes exactly the three documented correction fields", () => {
    expect(CORRECTION_FIELDS.map((f) => f.id).sort()).toEqual(
      ["bmi_range", "payout.settle_days", "stays"].sort(),
    );
    expect(isCorrectionFieldId("payout.settle_days")).toBe(true);
    expect(isCorrectionFieldId("age_max")).toBe(false); // gating field, deliberately not eligible
    expect(isCorrectionFieldId(123)).toBe(false);
  });
});

function consensus(overrides: Partial<CommunityFieldConsensus> = {}): CommunityFieldConsensus {
  return {
    studyId: "study-1",
    field: "payout.settle_days",
    status: "community-confirmed",
    confidence: 2,
    values: [{ value: "45", count: 2, reports: [] }],
    ...overrides,
  };
}

describe("sanitizeCommunityCorrectionsFile", () => {
  it("falls back to the empty file for null/non-object/malformed input", () => {
    expect(sanitizeCommunityCorrectionsFile(null)).toEqual(EMPTY_COMMUNITY_FILE);
    expect(sanitizeCommunityCorrectionsFile(undefined)).toEqual(EMPTY_COMMUNITY_FILE);
    expect(sanitizeCommunityCorrectionsFile("not an object")).toEqual(EMPTY_COMMUNITY_FILE);
    expect(sanitizeCommunityCorrectionsFile({})).toEqual({ generatedAt: "", fields: {} });
  });

  it("keeps well-formed entries and drops malformed ones, field by field", () => {
    const input = {
      generatedAt: "2026-08-08T00:00:00.000Z",
      fields: {
        "study-1::payout.settle_days": consensus(),
        "corrupt-entry": { studyId: "study-2" }, // missing required keys
        "study-2::stays": consensus({ studyId: "study-2", field: "stays", values: [{ value: "10", count: 1, reports: [] }] }),
      },
    };
    const out = sanitizeCommunityCorrectionsFile(input);
    expect(out.generatedAt).toBe("2026-08-08T00:00:00.000Z");
    expect(Object.keys(out.fields).sort()).toEqual(["study-1::payout.settle_days", "study-2::stays"]);
  });

  it("never throws on deeply malformed input", () => {
    expect(() => sanitizeCommunityCorrectionsFile({ fields: "not an object" })).not.toThrow();
    expect(() => sanitizeCommunityCorrectionsFile({ fields: { a: { field: "not-a-real-field" } } })).not.toThrow();
  });
});

describe("getFieldConsensus / getStudyCorrections", () => {
  const overlay: CommunityCorrectionsFile = {
    generatedAt: "2026-08-08T00:00:00.000Z",
    fields: {
      "study-1::payout.settle_days": consensus(),
      "study-1::stays": consensus({ field: "stays", status: "unverified", confidence: 1, values: [{ value: "10", count: 1, reports: [] }] }),
      "study-2::bmi_range": consensus({ studyId: "study-2", field: "bmi_range", status: "disputed", confidence: 3 }),
    },
  };

  it("looks up one study+field result", () => {
    expect(getFieldConsensus(overlay, "study-1", "payout.settle_days")?.status).toBe("community-confirmed");
    expect(getFieldConsensus(overlay, "study-1", "bmi_range")).toBeUndefined();
    expect(getFieldConsensus(null, "study-1", "stays")).toBeUndefined();
  });

  it("returns every field result for a study", () => {
    const results = getStudyCorrections(overlay, "study-1");
    expect(results.map((r) => r.field).sort()).toEqual(["payout.settle_days", "stays"]);
    expect(getStudyCorrections(overlay, "study-nonexistent")).toEqual([]);
  });
});

describe("mergeCommunityOverlay", () => {
  it("attaches a .community map keyed by field, without mutating the base records", () => {
    const overlay: CommunityCorrectionsFile = {
      generatedAt: "now",
      fields: { "s1::stays": consensus({ studyId: "s1", field: "stays" }) },
    };
    const base = [{ id: "s1", name: "Study One" }, { id: "s2", name: "Study Two" }];
    const merged = mergeCommunityOverlay(base, overlay);

    expect(merged[0].community.stays?.status).toBe("community-confirmed");
    expect(merged[1].community).toEqual({});
    // Original array/objects untouched -- data/studies.seed.json's own objects
    // (or any Study[] this is called with) are never mutated.
    expect((base[0] as Record<string, unknown>).community).toBeUndefined();
  });

  it("returns every base record even when the overlay is null/empty", () => {
    const base = [{ id: "s1" }, { id: "s2" }];
    expect(mergeCommunityOverlay(base, null).map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(mergeCommunityOverlay(base, EMPTY_COMMUNITY_FILE).every((s) => Object.keys(s.community).length === 0)).toBe(
      true,
    );
  });
});
