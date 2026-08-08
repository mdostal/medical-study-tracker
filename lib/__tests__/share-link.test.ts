import { describe, expect, it } from "vitest";
import { buildShareUrl, decodeShareState, encodeShareState, SHARE_PARAM } from "../share-link";
import { DEFAULT_ASSUMPTIONS, DEFAULT_SORT_KEY, type PersistedState } from "../types";

const CUSTOM_STATE: PersistedState = {
  assumptions: {
    ...DEFAULT_ASSUMPTIONS,
    home_base: "omaha",
    nanny_rate: 275,
    w_net: 0.5,
    w_velocity: 0.3,
    w_downtime: 0.2,
    model_childcare: true,
  },
  sortKey: "cash_velocity",
};

describe("share-link encode/decode round-trip", () => {
  it("reproduces the exact same PersistedState after encode -> decode", () => {
    const encoded = encodeShareState(CUSTOM_STATE);
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = decodeShareState(new URLSearchParams({ [SHARE_PARAM]: encoded }));
    expect(decoded).toEqual(CUSTOM_STATE);
  });

  it("buildShareUrl produces a URL whose search string decodes back to the same state", () => {
    const url = buildShareUrl("https://example.com/", CUSTOM_STATE);
    const parsed = new URL(url);
    expect(parsed.searchParams.has(SHARE_PARAM)).toBe(true);

    const decoded = decodeShareState(parsed.search);
    expect(decoded).toEqual(CUSTOM_STATE);
  });

  it("keeps the encoded payload compact (well under any practical URL length limit)", () => {
    const encoded = encodeShareState(CUSTOM_STATE);
    // Sanity bound, not a tight spec — the research decision's premise was
    // "well under 300 bytes"; this catches any accidental payload bloat.
    expect(encoded.length).toBeLessThan(400);
  });
});

describe("share-link malformed input fallback", () => {
  it("falls back to defaults when the share param is entirely missing", () => {
    const decoded = decodeShareState(new URLSearchParams());
    expect(decoded).toEqual({ assumptions: DEFAULT_ASSUMPTIONS, sortKey: DEFAULT_SORT_KEY });
  });

  it("falls back to defaults for garbage (non-base64) param value", () => {
    const decoded = decodeShareState(new URLSearchParams({ [SHARE_PARAM]: "!!!not-base64!!!" }));
    expect(decoded).toEqual({ assumptions: DEFAULT_ASSUMPTIONS, sortKey: DEFAULT_SORT_KEY });
  });

  it("falls back to defaults for validly-encoded but non-JSON content", () => {
    const notJson = Buffer.from("this is not json").toString("base64url");
    const decoded = decodeShareState(new URLSearchParams({ [SHARE_PARAM]: notJson }));
    expect(decoded).toEqual({ assumptions: DEFAULT_ASSUMPTIONS, sortKey: DEFAULT_SORT_KEY });
  });

  it("falls back to defaults for valid JSON of the wrong shape (e.g. an array)", () => {
    const wrongShape = Buffer.from(JSON.stringify([1, 2, 3])).toString("base64url");
    const decoded = decodeShareState(new URLSearchParams({ [SHARE_PARAM]: wrongShape }));
    expect(decoded).toEqual({ assumptions: DEFAULT_ASSUMPTIONS, sortKey: DEFAULT_SORT_KEY });
  });

  it("never throws on decode regardless of input", () => {
    const inputs = ["", " ", "%%%", "=====", "null", "undefined"];
    for (const raw of inputs) {
      expect(() =>
        decodeShareState(new URLSearchParams({ [SHARE_PARAM]: raw })),
      ).not.toThrow();
    }
  });
});
