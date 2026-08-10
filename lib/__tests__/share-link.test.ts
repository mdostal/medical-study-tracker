import { describe, expect, it } from "vitest";
import {
  APPLICATIONS_SHARE_PARAM,
  buildApplicationsShareUrl,
  buildShareUrl,
  decodeApplicationsShareState,
  decodeShareState,
  encodeApplicationsShareState,
  encodeShareState,
  SHARE_PARAM,
} from "../share-link";
import { DEFAULT_ASSUMPTIONS, DEFAULT_SORT_KEY, type Application, type PersistedState } from "../types";

const CUSTOM_STATE: PersistedState = {
  assumptions: {
    ...DEFAULT_ASSUMPTIONS,
    home_base: { city: "Omaha, NE", lat: 41.2565, lng: -95.9345 },
    backup_care_rate_per_night: 275,
    w_net: 0.5,
    w_velocity: 0.3,
    w_downtime: 0.2,
    has_dependents_needing_care: true,
  },
  sortKey: "cash_velocity",
  backup_care_hubs: ["AUS", "MSP"],
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
    // Sanity bound, not a tight spec. Bumped from the original 400 by
    // story: generalize-profile-inputs — home_base is now a {city, lat, lng}
    // shape rather than a 2-value literal, which adds real bytes; still
    // nowhere near a practical URL-length limit (browsers/servers
    // comfortably handle several KB).
    expect(encoded.length).toBeLessThan(600);
  });
});

describe("share-link malformed input fallback", () => {
  it("falls back to defaults when the share param is entirely missing", () => {
    const decoded = decodeShareState(new URLSearchParams());
    expect(decoded).toEqual({ assumptions: DEFAULT_ASSUMPTIONS, sortKey: DEFAULT_SORT_KEY, backup_care_hubs: [] });
  });

  it("falls back to defaults for garbage (non-base64) param value", () => {
    const decoded = decodeShareState(new URLSearchParams({ [SHARE_PARAM]: "!!!not-base64!!!" }));
    expect(decoded).toEqual({ assumptions: DEFAULT_ASSUMPTIONS, sortKey: DEFAULT_SORT_KEY, backup_care_hubs: [] });
  });

  it("falls back to defaults for validly-encoded but non-JSON content", () => {
    const notJson = Buffer.from("this is not json").toString("base64url");
    const decoded = decodeShareState(new URLSearchParams({ [SHARE_PARAM]: notJson }));
    expect(decoded).toEqual({ assumptions: DEFAULT_ASSUMPTIONS, sortKey: DEFAULT_SORT_KEY, backup_care_hubs: [] });
  });

  it("falls back to defaults for valid JSON of the wrong shape (e.g. an array)", () => {
    const wrongShape = Buffer.from(JSON.stringify([1, 2, 3])).toString("base64url");
    const decoded = decodeShareState(new URLSearchParams({ [SHARE_PARAM]: wrongShape }));
    expect(decoded).toEqual({ assumptions: DEFAULT_ASSUMPTIONS, sortKey: DEFAULT_SORT_KEY, backup_care_hubs: [] });
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

// story: application-data-model-and-persistence — the Applications map gets
// its own share-link encoding, same base64url-JSON-blob technique as
// PersistedState above ("included in the share-link encoding the same way
// Profile is"), own query param so the two never collide. Example values
// below are entirely generic placeholders (fictional-range phone number, no
// real name, no real biometric figure) — never sourced from the shared
// reference artifact.
const CUSTOM_APPLICATIONS: Record<string, Application> = {
  "study-generic-001": {
    study_id: "study-generic-001",
    channel: "call",
    status: "phone-screen",
    chase_state: "waiting",
    applied_date: "2026-01-05",
    confirmation: { has_number: true, confirmed_in_system: true, no_email_flag: false, ref: "CONF-0001" },
    contact: { phone: "+1-555-0100", tz: "America/Chicago" },
    next_action: "call to push",
    next_action_due: "2026-01-12",
    urgency: "this_week",
    call_log: [{ date: "2026-01-05", who: "clinic coordinator", summary: "Confirmed screening slot." }],
    confirmed: { nights: [3], visits: 1, bmi_ok: true },
    payout: { type: "lump_end", settle_days: 14 },
    washout_days: 30,
    stipend_per_visit: 50,
    notes: "Generic placeholder note.",
  },
};

describe("Applications share-link encode/decode round-trip", () => {
  it("reproduces the exact same Applications map after encode -> decode", () => {
    const encoded = encodeApplicationsShareState(CUSTOM_APPLICATIONS);
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = decodeApplicationsShareState(
      new URLSearchParams({ [APPLICATIONS_SHARE_PARAM]: encoded }),
    );
    expect(decoded).toEqual(CUSTOM_APPLICATIONS);
  });

  it("buildApplicationsShareUrl produces a URL whose search string decodes back to the same map", () => {
    const url = buildApplicationsShareUrl("https://example.com/", CUSTOM_APPLICATIONS);
    const parsed = new URL(url);
    expect(parsed.searchParams.has(APPLICATIONS_SHARE_PARAM)).toBe(true);

    const decoded = decodeApplicationsShareState(parsed.search);
    expect(decoded).toEqual(CUSTOM_APPLICATIONS);
  });

  it("uses a different param name than the Profile share param, so the two never collide", () => {
    expect(APPLICATIONS_SHARE_PARAM).not.toBe(SHARE_PARAM);
  });
});

describe("Applications share-link malformed input fallback", () => {
  it("falls back to {} when the param is entirely missing", () => {
    expect(decodeApplicationsShareState(new URLSearchParams())).toEqual({});
  });

  it("falls back to {} for garbage (non-base64) param value", () => {
    expect(
      decodeApplicationsShareState(new URLSearchParams({ [APPLICATIONS_SHARE_PARAM]: "!!!not-base64!!!" })),
    ).toEqual({});
  });

  it("falls back to {} for validly-encoded but non-JSON content", () => {
    const notJson = Buffer.from("this is not json").toString("base64url");
    expect(
      decodeApplicationsShareState(new URLSearchParams({ [APPLICATIONS_SHARE_PARAM]: notJson })),
    ).toEqual({});
  });

  it("falls back to {} for valid JSON of the wrong shape (e.g. an array)", () => {
    const wrongShape = Buffer.from(JSON.stringify([1, 2, 3])).toString("base64url");
    expect(
      decodeApplicationsShareState(new URLSearchParams({ [APPLICATIONS_SHARE_PARAM]: wrongShape })),
    ).toEqual({});
  });

  it("never throws regardless of input", () => {
    const inputs = ["", " ", "%%%", "=====", "null", "undefined"];
    for (const raw of inputs) {
      expect(() =>
        decodeApplicationsShareState(new URLSearchParams({ [APPLICATIONS_SHARE_PARAM]: raw })),
      ).not.toThrow();
    }
  });
});
