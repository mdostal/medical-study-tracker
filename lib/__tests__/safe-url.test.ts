import { describe, expect, it } from "vitest";
import { isSafeHttpUrl } from "../utils";

// story: reject-unsafe-scraped-urls -- adversarial release-readiness pass found that a study's
// source_url/apply_url/network_url (from scripts/pull-studies.mjs's daily scrape, a no-login
// community correction, or a visitor's own "add study by URL" submission) was rendered as a raw
// <a href> (components/ranked-table.tsx's studyLinkHref, plus stack-suggester-panel.tsx and
// app/networks/page.tsx) with no scheme check. `new URL(href, base)` only sanitizes RELATIVE
// resolution -- a compromised or buggy network site serving an absolute `javascript:`/`data:`
// href round-trips straight through to a real clickable link on this site's own origin, where
// visitor Profile/Applications localStorage data lives. isSafeHttpUrl() is the one guard every
// render site now calls before treating a string as a safe href.
describe("isSafeHttpUrl", () => {
  it("accepts real http and https URLs", () => {
    expect(isSafeHttpUrl("https://trialmed.com/studies/123")).toBe(true);
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects javascript: URLs", () => {
    expect(isSafeHttpUrl("javascript:alert(document.cookie)")).toBe(false);
  });

  it("rejects data: URLs", () => {
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects other non-http(s) schemes", () => {
    expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeHttpUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects malformed strings that don't parse as a URL", () => {
    expect(isSafeHttpUrl("not a url")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
  });

  it("rejects undefined/null", () => {
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
  });
});
