// Profile/Assumptions persistence — the ONLY module in this codebase allowed
// to read or write localStorage (or any other browser storage API) for the
// visitor's Profile state. lib/scoring.ts and lib/types.ts must never import
// this module, and must never touch a browser storage API directly — see
// this story's acceptance criteria and CLAUDE.md's architecture section.
// (lib/local-status-store.ts is a separate, sibling adapter for a different
// concern — per-study status-pipeline state — not a violation of this
// boundary; the constraint is per-concern, not "grep the whole repo.")
//
// Reads/writes the global `localStorage` identifier directly (not
// `window.localStorage`), matching lib/local-status-store.ts's convention —
// works in real browsers and in test environments that stub it via
// `vi.stubGlobal("localStorage", ...)` without needing a full jsdom/window
// shim.
//
// All shape validation/defaulting lives in lib/types.ts's
// sanitizePersistedState() — shared with lib/share-link.ts so "restore from
// localStorage" and "restore from a share link" fall back to the exact same
// defaults the exact same way.

import { sanitizePersistedState, type PersistedState, type Study } from "./types";

const STORAGE_KEY = "mst.profileState.v1";

// Story add-study-by-url reuses this module (rather than a second
// localStorage adapter) for the visitor's own added-studies list — same
// "one module touches storage" boundary local-persistence-share-links
// established for the Profile. Separate key so a corrupt/cleared Profile
// never wipes a visitor's added studies or vice versa.
const USER_STUDIES_KEY = "mst.userStudies.v1";

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

/** Reads the persisted Profile/Assumptions state. Returns null if unavailable/unset/corrupt. */
export function loadPersistedState(): PersistedState | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizePersistedState(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persists the Profile/Assumptions state. No-ops if localStorage is unavailable. */
export function savePersistedState(state: PersistedState): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private-browsing quota, disabled storage, etc. — fail silently; the
    // in-memory UI state still works for the rest of this page view, it
    // just won't survive a reload.
  }
}

/** Clears the persisted Profile/Assumptions state, if any. */
export function clearPersistedState(): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// --- User-added studies (story: add-study-by-url) --------------------------
//
// A visitor's own "add study by URL" entries — confirmed/edited via
// components/add-study-form.tsx, always tagged user_added:true (see
// lib/types.ts). Never submitted to any server, never merged into
// data/studies.seed.json, never visible to any other visitor — this array
// lives only in this browser's localStorage, same as the Profile above.

/** Minimal shape check on parsed JSON before treating an entry as a Study —
 * corrupt/foreign localStorage content is dropped per-entry, never thrown. */
function looksLikeStudy(value: unknown): value is Study {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.network === "string" &&
    typeof v.pay_gross === "number" &&
    typeof v.payout === "object" &&
    v.payout !== null
  );
}

/** Reads the visitor's own added studies. Returns [] if unavailable/unset/corrupt. */
export function loadUserStudies(): Study[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(USER_STUDIES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(looksLikeStudy).map((s) => ({ ...s, user_added: true }));
  } catch {
    return [];
  }
}

/** Persists the visitor's full added-studies list. No-ops if localStorage is unavailable. */
export function saveUserStudies(studies: Study[]): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(USER_STUDIES_KEY, JSON.stringify(studies));
  } catch {
    // Private-browsing quota, disabled storage, etc. — fail silently, same
    // as savePersistedState above.
  }
}

/** Appends one study (forcing user_added:true) and persists the result. */
export function addUserStudy(study: Study): Study[] {
  const next = [...loadUserStudies(), { ...study, user_added: true as const }];
  saveUserStudies(next);
  return next;
}

/** Removes one added study by id and persists the result. */
export function removeUserStudy(id: string): Study[] {
  const next = loadUserStudies().filter((s) => s.id !== id);
  saveUserStudies(next);
  return next;
}
