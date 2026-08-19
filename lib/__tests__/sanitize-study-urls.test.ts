import { describe, expect, it } from "vitest";
import { sanitizeStudyUrls } from "../../scripts/pull-studies.mjs";

// story: reject-unsafe-scraped-urls -- write-time half of the defense (see
// lib/__tests__/safe-url.test.ts for the render-time half). scripts/pull-studies.mjs builds
// source_url/apply_url/network_url via `new URL(href, base)` against whatever a network's own
// site published; sanitizeStudyUrls() is the merge-time choke point that strips a field rather
// than trusting it (or dropping the whole study) when it resolves to a non-http(s) scheme.
describe("sanitizeStudyUrls", () => {
  it("leaves a study with only safe http(s) URLs untouched", () => {
    const study = { id: "1", source_url: "https://trialmed.com/1", apply_url: "http://a.com/2" };
    expect(sanitizeStudyUrls(study)).toEqual(study);
  });

  it("strips an unsafe source_url but keeps the rest of the study", () => {
    const study = { id: "1", city: "Austin", source_url: "javascript:alert(1)", phone: "555-1234" };
    const sanitized = sanitizeStudyUrls(study);
    expect(sanitized.source_url).toBeUndefined();
    expect(sanitized).toMatchObject({ id: "1", city: "Austin", phone: "555-1234" });
  });

  it("strips an unsafe apply_url and an unsafe network_url independently", () => {
    const study = {
      id: "1",
      apply_url: "data:text/html,<script>1</script>",
      network_url: "javascript:void(0)",
    };
    const sanitized = sanitizeStudyUrls(study);
    expect(sanitized.apply_url).toBeUndefined();
    expect(sanitized.network_url).toBeUndefined();
  });

  it("does not mutate the original study object", () => {
    const study = { id: "1", source_url: "javascript:alert(1)" };
    sanitizeStudyUrls(study);
    expect(study.source_url).toBe("javascript:alert(1)");
  });
});
