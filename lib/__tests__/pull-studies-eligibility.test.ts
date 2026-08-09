import { describe, expect, it } from "vitest";
import {
  parseAgeFromDetailText,
  parseEligibilityText,
  parseMinWeightLbFromText,
  parseSexFromText,
  parseSmokerFromText,
} from "../../scripts/pull-studies.mjs";

// story: scrape-detail-page-eligibility -- root-cause fix. scripts/pull-studies.mjs's Fortrea,
// ICON, and JBR pullers used to read ONLY the listing page/card (pay, dates, title) and never
// visited a study's own detail page, where the real eligibility criteria (BMI floor/ceiling,
// special-population gates) actually live -- a real correctness bug (a Fortrea GLP-1-medication
// study requiring BMI 25+ had shipped with bmi_min/bmi_max/special_pop all null, silently showing
// as available to anyone). These tests exercise the shared text-parsers those pullers now use,
// against exact `body.innerText` strings captured live from each network's own detail pages
// (2026-08-09) -- not invented fixtures.
describe("parseEligibilityText", () => {
  it("extracts a BMI floor with no stated ceiling (Fortrea study 781236's own wording)", () => {
    const text =
      "Madison, WI is currently recruiting Healthy Adults Currently on GLP-1 medication for at " +
      "least 2 months prior to screening, ages 18-70.\n\nWomen Eligibility Criteria\n\nWomen can " +
      "be of childbearing potential or non-childbearing potential.\n\nBody Mass Index\n\n" +
      "Participants must have a BMI of:\n25+\n\nSmoking Criteria\n\nSmoking is allowed.";
    expect(parseEligibilityText(text)).toEqual({
      bmi_min: 25,
      bmi_max: null,
      special_pop: "overweight_obese", // "GLP-1 medication" is the page's own population wording
    });
  });

  it("extracts a Fortrea BMI range with no special population", () => {
    const text = "Body Mass Index\n\nParticipants must have a BMI of:\n18-32\n\nScreening procedures";
    expect(parseEligibilityText(text)).toEqual({ bmi_min: 18, bmi_max: 32, special_pop: null });
  });

  it("extracts an ICON BMI range + explicit overweight/obese wording (study 793/'3054AC')", () => {
    const text =
      "WHO CAN PARTICIPATE?\nMale/Female\nAge 18 - 65\nBMI 27.0 - 99.0\nOverweight or have obesity\n" +
      "Stable body weight for the past 3 months";
    expect(parseEligibilityText(text)).toEqual({ bmi_min: 27, bmi_max: 99, special_pop: "overweight_obese" });
  });

  it("never infers special_pop from an elevated BMI floor alone (ICON study 3705-0020)", () => {
    // Live-verified 2026-08-09: this study's own detail page states a BMI 27.0-99.0 floor with NO
    // population sentence anywhere on the page -- per docs/DATA-INTEGRITY.md's anti-fabrication
    // rule, special_pop must stay null here even though the number alone looks similar to the
    // "overweight or have obesity" studies above.
    const text = "WHO CAN PARTICIPATE?\nMale/Female\nAge 18 - 65\nNon Smoker\nBMI 27.0 - 99.0";
    expect(parseEligibilityText(text)).toEqual({ bmi_min: 27, bmi_max: 99, special_pop: null });
  });

  it("extracts a JBR BMI range from its 'BMI between' blurb wording", () => {
    const text = "Healthy\nMust have a BMI between 18-32.0kg/m2 \nMust weigh at least 110 lbs";
    expect(parseEligibilityText(text)).toEqual({ bmi_min: 18, bmi_max: 32, special_pop: null });
  });

  it("stays all-null (never guesses) when the detail page doesn't publish BMI", () => {
    expect(parseEligibilityText("Call for details. No published criteria here.")).toEqual({
      bmi_min: null,
      bmi_max: null,
      special_pop: null,
    });
    expect(parseEligibilityText("")).toEqual({ bmi_min: null, bmi_max: null, special_pop: null });
  });

  it("doesn't misfire off an unrelated 'BMI Calculator' widget with no adjoining numbers", () => {
    const text = "Additional Details\n\nBMI Calculator\nWeight\nHeight\nFeet\nInches\nCALCULATE";
    expect(parseEligibilityText(text)).toEqual({ bmi_min: null, bmi_max: null, special_pop: null });
  });

  // Regression test for a real false positive caught live 2026-08-09 (Fortrea study 782366): a
  // bare "obesity"/"overweight" keyword search matched the DRUG's target condition, not an actual
  // participant requirement, and mislabeled a plain "Healthy Adults" study as overweight/obese-only.
  it("does not flag special_pop from the drug's target condition, only an actual participant requirement", () => {
    const text =
      "This is a research study for an investigational drug being developed for the treatment " +
      "of obesity. Dallas, TX is currently recruiting Healthy Adults, ages 18-65.\n\n" +
      "Body Mass Index\n\nParticipants must have a BMI of:\n20-32";
    expect(parseEligibilityText(text)).toEqual({ bmi_min: 20, bmi_max: 32, special_pop: null });
  });
});

describe("parseSmokerFromText", () => {
  it("recognizes non-smoker and smoker-allowed wordings", () => {
    expect(parseSmokerFromText("Non Smoker")).toBe("non");
    expect(parseSmokerFromText("Smoking is allowed.")).toBe("any");
    expect(parseSmokerFromText("Smokers & non-smokers allowed")).toBe("any");
  });

  it("returns null (caller keeps its own value) when the page doesn't say", () => {
    expect(parseSmokerFromText("no mention of smoking here")).toBeNull();
    expect(parseSmokerFromText("")).toBeNull();
  });
});

describe("parseSexFromText", () => {
  it("recognizes Male/Female wordings", () => {
    expect(parseSexFromText("Male/Female")).toBe("M/F");
    expect(parseSexFromText("Male and Female")).toBe("M/F");
  });

  it("recognizes a female-only or male-only gate", () => {
    expect(parseSexFromText("Female Only participants may enroll")).toBe("female");
    expect(parseSexFromText("Women Only")).toBe("female");
    expect(parseSexFromText("Male Only")).toBe("male");
  });

  // "female" contains "male" as a literal substring -- this must never misfire.
  it("never reads a male-only gate off a female-only page", () => {
    expect(parseSexFromText("This study is Female Only, no male participants.")).toBe("female");
  });

  it("returns null when the page doesn't say", () => {
    expect(parseSexFromText("no sex criteria mentioned")).toBeNull();
  });
});

describe("parseAgeFromDetailText", () => {
  it("extracts an ICON-style 'Age X - Y' line", () => {
    expect(parseAgeFromDetailText("Age 18 - 68")).toEqual({ age_min: 18, age_max: 68 });
  });

  it("extracts a Fortrea-style 'ages X-Y' sentence", () => {
    expect(parseAgeFromDetailText("currently recruiting Healthy Adults, ages 18-70.")).toEqual({
      age_min: 18,
      age_max: 70,
    });
  });

  it("extracts a JBR-style 'X-Y years old' line", () => {
    expect(parseAgeFromDetailText("18-65 years old")).toEqual({ age_min: 18, age_max: 65 });
  });

  it("returns null when the page doesn't clearly state a range", () => {
    expect(parseAgeFromDetailText("adults welcome")).toBeNull();
  });
});

describe("parseMinWeightLbFromText", () => {
  it("extracts a stated minimum weight", () => {
    expect(parseMinWeightLbFromText("Must weigh at least 110 lbs")).toBe(110);
  });

  it("returns null when unstated", () => {
    expect(parseMinWeightLbFromText("no weight requirement mentioned")).toBeNull();
  });
});
