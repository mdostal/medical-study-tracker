import { describe, expect, it } from "vitest";
import {
  cacheBustedUrl,
  extractStudyFields,
  htmlToText,
  isFetchableHttpUrl,
  isKnownNetworkUrl,
  knownNetworkDomains,
  parseAgeRange,
  parseBmiRange,
  parseMinWeight,
  parseNightsVisits,
  parsePay,
} from "../study-extract";
import networksSeed from "../../data/networks.json";

describe("parsePay", () => {
  it("takes the ceiling figure from an 'up to' range", () => {
    expect(parsePay("Up to $32,500")).toBe(32500);
    expect(parsePay("$22,524 to $23,132")).toBe(23132);
  });
  it("returns null for no dollar figures", () => {
    expect(parsePay("call for details")).toBeNull();
    expect(parsePay(null)).toBeNull();
  });
});

describe("parseAgeRange", () => {
  it("parses a dash range", () => {
    expect(parseAgeRange("Age 18 - 55")).toEqual({ age_min: 18, age_max: 55 });
  });
  it("parses a plus range", () => {
    expect(parseAgeRange("18+")).toEqual({ age_min: 18, age_max: 99 });
  });
  it("defaults to 18-99 when nothing matches", () => {
    expect(parseAgeRange("adults only")).toEqual({ age_min: 18, age_max: 99 });
    expect(parseAgeRange(null)).toEqual({ age_min: 18, age_max: 99 });
  });
});

describe("parseNightsVisits", () => {
  it("parses stays and follow-up visits", () => {
    expect(
      parseNightsVisits(
        "Participation in this study includes 2 screening visits, 1 stay of 10 nights (11 days), and 14 follow-up visits.",
      ),
    ).toEqual({ stays: [10], visits: 14 });
  });
  it("expands multiple separate stays", () => {
    expect(parseNightsVisits("2 separate stays of 6 nights")).toEqual({ stays: [6, 6], visits: null });
  });
  it("returns nulls when nothing matches", () => {
    expect(parseNightsVisits("no matching text")).toEqual({ stays: null, visits: null });
  });

  it("doesn't re-count the same sentence repeated far apart on the page (real ICON bug found live)", () => {
    // Regression for a real page (ICON study detail, live-verified while
    // building this story): the study's own description sentence appears
    // 3x on one page (hero, summary, FAQ) — each repeat several hundred
    // chars apart. A naive whole-text global match tripled the real stays.
    const sentence = "1 stay of 5 nights (6 days), 4 stays of 3 nights (4 days) each, and 2 follow-up visits.";
    const filler = "x".repeat(350);
    const text = `Participation in this study includes ${sentence} ${filler} Also: ${sentence} ${filler} FAQ: ${sentence}`;
    expect(parseNightsVisits(text)).toEqual({ stays: [5, 3, 3, 3, 3], visits: 2 });
  });
});

describe("parseBmiRange", () => {
  it("parses 'BMI: Between X and Y'", () => {
    expect(parseBmiRange("BMI: Between 18 and 32")).toEqual({ bmi_min: 18, bmi_max: 32 });
  });
  it("parses 'BMI 18-32'", () => {
    expect(parseBmiRange("BMI 18-32 required")).toEqual({ bmi_min: 18, bmi_max: 32 });
  });
  it("returns nulls when absent", () => {
    expect(parseBmiRange("no BMI info here")).toEqual({ bmi_min: null, bmi_max: null });
  });
});

describe("parseMinWeight", () => {
  it("parses 'at least N lbs'", () => {
    expect(parseMinWeight("must weigh at least 110 lbs")).toBe(110);
  });
  it("returns null when absent", () => {
    expect(parseMinWeight("no weight requirement")).toBeNull();
  });
});

describe("htmlToText", () => {
  it("strips scripts, styles, comments, and tags", () => {
    const html = `<html><head><style>.a{color:red}</style><script>evil()</script></head>
      <body><!-- hidden --><h1>Title</h1><p>BMI 18-32, ages 18-55.</p></body></html>`;
    const text = htmlToText(html);
    expect(text).not.toMatch(/evil\(\)/);
    expect(text).not.toMatch(/color:red/);
    expect(text).toContain("Title");
    expect(text).toContain("BMI 18-32, ages 18-55.");
  });

  it("never throws on malformed markup", () => {
    expect(() => htmlToText("<div><span>unterminated")).not.toThrow();
  });
});

describe("extractStudyFields", () => {
  it("extracts a realistic study detail page end-to-end", () => {
    const html = `<html><head><title>Healthy Volunteer Study #123</title></head>
      <body>
        <h1>Compensation up to $8,350</h1>
        <p>Ages 18 - 55. BMI: Between 18 and 32. Must weigh at least 110 lbs.</p>
        <p>Participation includes 1 stay of 10 nights (11 days), and 4 follow-up visits.</p>
      </body></html>`;
    expect(extractStudyFields(html)).toEqual({
      title: "Healthy Volunteer Study #123",
      pay_gross: 8350,
      age_min: 18,
      age_max: 55,
      stays: [10],
      visits: 4,
      bmi_min: 18,
      bmi_max: 32,
      min_weight_lb: 110,
    });
  });

  it("never throws and degrades to nulls/defaults on a page with none of these patterns", () => {
    expect(() => extractStudyFields("<html><body>Nothing useful here.</body></html>")).not.toThrow();
    const result = extractStudyFields("<html><body>Nothing useful here.</body></html>");
    expect(result.pay_gross).toBeNull();
    expect(result.age_min).toBe(18);
    expect(result.age_max).toBe(99);
    expect(result.stays).toBeNull();
    expect(result.bmi_min).toBeNull();
  });
});

describe("isFetchableHttpUrl", () => {
  it("accepts http(s) URLs only", () => {
    expect(isFetchableHttpUrl("https://iconstudies.com/study/1")).toBe(true);
    expect(isFetchableHttpUrl("http://example.com")).toBe(true);
  });
  it("rejects non-http(s) schemes and malformed input", () => {
    expect(isFetchableHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isFetchableHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isFetchableHttpUrl("not a url")).toBe(false);
  });
});

describe("knownNetworkDomains + isKnownNetworkUrl (AC1: 'a known network per data/networks.json')", () => {
  const domains = knownNetworkDomains(JSON.stringify(networksSeed));

  it("recognizes a documented network portal domain", () => {
    expect(domains.has("iconstudies.com")).toBe(true);
    expect(domains.has("trialmed.com")).toBe(true);
    expect(isKnownNetworkUrl("https://iconstudies.com/All-Clinical-Research-Studies/study-1", domains)).toBe(
      true,
    );
  });

  it("recognizes a subdomain of a documented per-site portal", () => {
    expect(isKnownNetworkUrl("https://participantskc.altasciences.com/available-studies", domains)).toBe(
      true,
    );
  });

  it("treats www. as equivalent (matches both directions)", () => {
    expect(isKnownNetworkUrl("https://www.iconstudies.com/study/1", domains)).toBe(true);
  });

  it("falls back to false for an unrecognized host (AC2's trigger)", () => {
    expect(isKnownNetworkUrl("https://some-random-blog.example.com/post", domains)).toBe(false);
  });
});

describe("cacheBustedUrl", () => {
  it("appends a nocache query param without dropping the path", () => {
    const url = cacheBustedUrl("https://iconstudies.com/study/1");
    expect(url).toMatch(/^https:\/\/iconstudies\.com\/study\/1\?nocache=\d+$/);
  });
});
