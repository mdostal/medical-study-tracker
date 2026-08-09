import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  CONFIRMED_LABEL,
  CORRECTION_LABEL,
  DISPUTED_LABEL,
  aggregateIssues,
  computeConsensus,
  parseCorrectionIssue,
} from "../../scripts/aggregate-corrections.mjs";

// Builds a minimal GitHub issue object shaped like the REST API's response,
// with an embedded <!--mst-correction {...} --> block matching exactly what
// app/api/submit-correction/route.ts writes.
function makeIssue({
  number,
  studyId,
  field,
  value,
  note,
  submittedAt = "2026-08-08T00:00:00.000Z",
  createdAt = submittedAt,
  labels = [CORRECTION_LABEL],
  bodyOverride,
}: {
  number: number;
  studyId?: string;
  field?: string;
  value?: string;
  note?: string;
  submittedAt?: string;
  createdAt?: string;
  labels?: string[];
  bodyOverride?: string;
}) {
  const block = JSON.stringify({ studyId, field, value, note, submittedAt });
  return {
    number,
    html_url: `https://github.com/mdostal/medical-study-tracker/issues/${number}`,
    created_at: createdAt,
    labels: labels.map((name) => ({ name })),
    body: bodyOverride ?? `### Data correction report\n\n<!--mst-correction\n${block}\n-->\n`,
  };
}

describe("parseCorrectionIssue", () => {
  it("parses a well-formed issue body", () => {
    const issue = makeIssue({ number: 1, studyId: "0018-1399", field: "payout.settle_days", value: "45", note: "called and confirmed" });
    const parsed = parseCorrectionIssue(issue);
    expect(parsed).toMatchObject({
      studyId: "0018-1399",
      field: "payout.settle_days",
      value: "45",
      note: "called and confirmed",
      issue: 1,
    });
  });

  it("returns null for an issue with no mst-correction block at all (hand-opened / spam issue)", () => {
    const issue = { number: 2, html_url: "x", created_at: "x", labels: [], body: "I think the pay is wrong, please fix!!" };
    expect(parseCorrectionIssue(issue)).toBeNull();
  });

  it("returns null for a block containing invalid JSON", () => {
    const issue = { number: 3, html_url: "x", created_at: "x", labels: [], body: "<!--mst-correction\n{not valid json\n-->" };
    expect(parseCorrectionIssue(issue)).toBeNull();
  });

  it("returns null when required fields are missing or wrong-typed", () => {
    expect(parseCorrectionIssue(makeIssue({ number: 4, field: "payout.settle_days", value: "45" }))).toBeNull(); // no studyId
    expect(parseCorrectionIssue(makeIssue({ number: 5, studyId: "s1", value: "45" }))).toBeNull(); // no field
    expect(parseCorrectionIssue(makeIssue({ number: 6, studyId: "s1", field: "stays" }))).toBeNull(); // no value
  });

  it("rejects oversized studyId/field/value/note as malformed rather than truncating silently", () => {
    const issue = makeIssue({ number: 7, studyId: "s".repeat(200), field: "stays", value: "10" });
    expect(parseCorrectionIssue(issue)).toBeNull();
  });

  it("truncates an overlong note rather than rejecting the whole report", () => {
    const issue = makeIssue({ number: 8, studyId: "s1", field: "stays", value: "10", note: "x".repeat(900) });
    const parsed = parseCorrectionIssue(issue);
    expect(parsed?.note?.length).toBe(500);
  });

  it("falls back to the issue's created_at when submittedAt is missing/invalid", () => {
    const issue = makeIssue({ number: 9, studyId: "s1", field: "stays", value: "10", submittedAt: "not-a-date", createdAt: "2026-08-01T00:00:00.000Z" });
    expect(parseCorrectionIssue(issue)?.submittedAt).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("computeConsensus", () => {
  it("locks in community-confirmed with exactly 2 agreeing reports", () => {
    const reports = [
      { studyId: "s1", field: "payout.settle_days", value: "45", submittedAt: "2026-08-01T00:00:00.000Z", issue: 1, url: "u1" },
      { studyId: "s1", field: "payout.settle_days", value: "45", submittedAt: "2026-08-02T00:00:00.000Z", issue: 2, url: "u2" },
    ];
    const { fields, labelPlan } = computeConsensus(reports);
    const result = fields["s1::payout.settle_days"];
    expect(result.status).toBe("community-confirmed");
    expect(result.confidence).toBe(2);
    expect(result.values).toEqual([{ value: "45", count: 2, reports: [
      { issue: 1, url: "u1", submittedAt: "2026-08-01T00:00:00.000Z" },
      { issue: 2, url: "u2", submittedAt: "2026-08-02T00:00:00.000Z" },
    ] }]);
    expect(labelPlan).toEqual([
      { issue: 1, url: "u1", action: "confirm" },
      { issue: 2, url: "u2", action: "confirm" },
    ]);
  });

  it("a 3rd agreeing report keeps confidence climbing rather than resetting", () => {
    const reports = [
      { studyId: "s1", field: "stays", value: "10", submittedAt: "2026-08-01T00:00:00.000Z", issue: 1, url: "u1" },
      { studyId: "s1", field: "stays", value: "10", submittedAt: "2026-08-02T00:00:00.000Z", issue: 2, url: "u2" },
      { studyId: "s1", field: "stays", value: "10", submittedAt: "2026-08-03T00:00:00.000Z", issue: 3, url: "u3" },
    ];
    expect(computeConsensus(reports).fields["s1::stays"].confidence).toBe(3);
  });

  it("marks a field disputed on ANY disagreement, even a 2-vs-1 split, and preserves every value", () => {
    const reports = [
      { studyId: "s1", field: "stays", value: "10", submittedAt: "2026-08-01T00:00:00.000Z", issue: 1, url: "u1" },
      { studyId: "s1", field: "stays", value: "10", submittedAt: "2026-08-02T00:00:00.000Z", issue: 2, url: "u2" },
      { studyId: "s1", field: "stays", value: "12", submittedAt: "2026-08-03T00:00:00.000Z", issue: 3, url: "u3" },
    ];
    const { fields, labelPlan } = computeConsensus(reports);
    const result = fields["s1::stays"];
    expect(result.status).toBe("disputed");
    expect(result.confidence).toBe(3); // total reports, not just the majority value's count
    expect(result.values).toEqual([
      { value: "10", count: 2, reports: expect.any(Array) },
      { value: "12", count: 1, reports: expect.any(Array) },
    ]);
    // Never silently resolved to the majority value -- every value is present.
    expect(result.values.map((v) => v.value).sort()).toEqual(["10", "12"]);
    expect(labelPlan.every((p) => p.action === "dispute")).toBe(true);
    expect(labelPlan.map((p) => p.issue).sort()).toEqual([1, 2, 3]);
  });

  it("a single submission is unverified with confidence 1, and not labeled/closed", () => {
    const reports = [{ studyId: "s1", field: "bmi_range", value: "18-30", submittedAt: "2026-08-01T00:00:00.000Z", issue: 1, url: "u1" }];
    const { fields, labelPlan } = computeConsensus(reports);
    const result = fields["s1::bmi_range"];
    expect(result.status).toBe("unverified");
    expect(result.confidence).toBe(1);
    expect(result.values).toEqual([{ value: "18-30", count: 1, reports: expect.any(Array) }]);
    expect(labelPlan).toEqual([]);
  });

  it("keeps different studies and different fields on the same study fully independent", () => {
    const reports = [
      { studyId: "s1", field: "stays", value: "10", submittedAt: "t", issue: 1, url: "u1" },
      { studyId: "s2", field: "stays", value: "20", submittedAt: "t", issue: 2, url: "u2" },
      { studyId: "s1", field: "payout.settle_days", value: "45", submittedAt: "t", issue: 3, url: "u3" },
    ];
    const { fields } = computeConsensus(reports);
    expect(Object.keys(fields).sort()).toEqual(["s1::payout.settle_days", "s1::stays", "s2::stays"]);
    expect(fields["s1::stays"].status).toBe("unverified");
    expect(fields["s2::stays"].status).toBe("unverified");
  });
});

describe("aggregateIssues (end-to-end over raw GitHub-issue-shaped objects)", () => {
  it("full scenario: confirmed, disputed, unverified, and malformed/spam side by side", () => {
    const issues = [
      // 2 agreeing -> community-confirmed
      makeIssue({ number: 1, studyId: "study-A", field: "payout.settle_days", value: "45", submittedAt: "2026-08-01T00:00:00.000Z" }),
      makeIssue({ number: 2, studyId: "study-A", field: "payout.settle_days", value: "45", submittedAt: "2026-08-02T00:00:00.000Z" }),
      // conflicting -> disputed
      makeIssue({ number: 3, studyId: "study-B", field: "stays", value: "10", submittedAt: "2026-08-01T00:00:00.000Z" }),
      makeIssue({ number: 4, studyId: "study-B", field: "stays", value: "14", submittedAt: "2026-08-02T00:00:00.000Z" }),
      // single -> unverified
      makeIssue({ number: 5, studyId: "study-C", field: "bmi_range", value: "18-30", submittedAt: "2026-08-01T00:00:00.000Z" }),
      // malformed body -> skipped entirely, must not throw or appear anywhere in the output
      { number: 6, html_url: "x", created_at: "x", labels: [{ name: CORRECTION_LABEL }], body: "no structured block here, just spam text" },
      // manually flagged as spam by the owner (optional escape hatch) -> skipped regardless of body validity
      makeIssue({ number: 7, studyId: "study-A", field: "payout.settle_days", value: "999", labels: [CORRECTION_LABEL, "spam"] }),
      // a pull request the issues endpoint also returned -> excluded
      { number: 8, pull_request: {}, html_url: "x", created_at: "x", labels: [{ name: CORRECTION_LABEL }], body: "n/a" },
    ];

    const { fields } = aggregateIssues(issues);

    expect(fields["study-A::payout.settle_days"]).toMatchObject({ status: "community-confirmed", confidence: 2 });
    expect(fields["study-B::stays"]).toMatchObject({ status: "disputed", confidence: 2 });
    expect(fields["study-B::stays"].values.map((v: { value: string }) => v.value).sort()).toEqual(["10", "14"]);
    expect(fields["study-C::bmi_range"]).toMatchObject({ status: "unverified", confidence: 1 });

    // Issue #6 (malformed) and #7 (spam-labeled) never contributed a report.
    expect(fields["study-A::payout.settle_days"].values[0].count).toBe(2);
    expect(Object.keys(fields).sort()).toEqual([
      "study-A::payout.settle_days",
      "study-B::stays",
      "study-C::bmi_range",
    ]);
  });

  it("never throws on a completely empty or garbage issue list", () => {
    expect(aggregateIssues([]).fields).toEqual({});
    expect(() => aggregateIssues([{}, { body: null }, { labels: null }])).not.toThrow();
  });
});

describe("labels this script would apply", () => {
  it("exposes the exact label strings used for confirmed vs. disputed groups", () => {
    expect(CONFIRMED_LABEL).toBe("community-confirmed");
    expect(DISPUTED_LABEL).toBe("community-disputed");
  });
});

// Regression guard for this story's explicit acceptance criterion: "lands in
// data/community-corrections.json ... without modifying data/studies.seed.json
// -- the two datasets stay separate." The pure functions above provably never
// touch the filesystem (no readFile/writeFile calls in them at all), and this
// guards against a future edit accidentally wiring studies.seed.json into this
// script's write path.
describe("data/studies.seed.json isolation", () => {
  it("scripts/aggregate-corrections.mjs's only write target is data/community-corrections.json", async () => {
    const source = await readFile(new URL("../../scripts/aggregate-corrections.mjs", import.meta.url), "utf8");
    // The one output path this script ever writes to.
    expect(source).toContain('path.join(ROOT, "data", "community-corrections.json")');
    // No writeFile call anywhere in the script targets studies.seed.json -- the mention of that
    // filename elsewhere in this file is documentation prose only (explaining that this script
    // never touches it), never an actual fs call.
    expect(/writeFile\([^;]*studies\.seed/s.test(source)).toBe(false);
  });
});
