// Encode/decode the tunable Profile/Assumptions state (+ sort order) to/from
// a URL-safe string, so a "share this view" link reproduces the same ranked
// view for someone with no prior localStorage of their own — the
// design-discussion.md §9.3 "shareable link" half of the auth pivot.
//
// Research decision (this story's `research` step): a single base64url-
// encoded JSON blob in one query param, not a compression library and not
// one query param per field.
//   - Size: PersistedState is ~10 numeric/boolean/enum Assumptions fields
//     plus a sort key. Stringified JSON is well under 300 bytes — nowhere
//     near a practical URL-length limit (browsers/servers comfortably
//     handle several KB), so a compression dependency (e.g. lz-string)
//     would be complexity bought for no real payoff at this size.
//   - One blob param (vs. one query param per field) means a future
//     Assumptions field never needs new param-mapping code in this file —
//     sanitizePersistedState (lib/types.ts) already handles missing/extra
//     fields by falling back to defaults, so encode/decode stay generic.
//
// This module is deliberately as browser-API-free as lib/scoring.ts: the
// base64 helpers use only atob/btoa/TextEncoder/TextDecoder/URL/
// URLSearchParams, all standard globals available in browsers AND in
// Node/vitest — never `localStorage` or `window`. That's lib/profile-store.ts's
// job, not this one's.

import { sanitizePersistedState, type PersistedState } from "./types";

export const SHARE_PARAM = "s";

function encodeBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encodes state into the opaque value that goes in the `s` query param. */
export function encodeShareState(state: PersistedState): string {
  try {
    return encodeBase64Url(JSON.stringify(state));
  } catch {
    return "";
  }
}

/** Builds a full share URL from a base URL (origin + pathname) and state. */
export function buildShareUrl(baseUrl: string, state: PersistedState): string {
  const url = new URL(baseUrl);
  const encoded = encodeShareState(state);
  if (encoded) {
    url.searchParams.set(SHARE_PARAM, encoded);
  } else {
    url.searchParams.delete(SHARE_PARAM);
  }
  return url.toString();
}

/**
 * Decodes state out of a URL's search string/params. Missing or malformed
 * input (bad base64, invalid JSON, wrong shape) always falls back to
 * sanitizePersistedState's defaults rather than throwing — see this story's
 * "malformed share link" acceptance criterion.
 */
export function decodeShareState(search: string | URLSearchParams): PersistedState {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const raw = params.get(SHARE_PARAM);
  if (!raw) return sanitizePersistedState(undefined);
  try {
    return sanitizePersistedState(JSON.parse(decodeBase64Url(raw)));
  } catch {
    return sanitizePersistedState(undefined);
  }
}
