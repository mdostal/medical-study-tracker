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

import { sanitizePersistedState, type PersistedState } from "./types";

const STORAGE_KEY = "mst.profileState.v1";

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
