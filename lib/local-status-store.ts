// Per-study status pipeline persistence — framework-free (no React/Next.js
// imports), matching lib/scoring.ts's own convention. Per CLAUDE.md /
// design-discussion.md §9: no server-side or account-based storage, ever —
// localStorage is the ONLY persistence layer for this v1.
//
// Note: this reads/writes the global `localStorage` identifier directly
// (not `window.localStorage`) so it works in any environment that exposes
// it as a global — real browsers, and test environments that stub it via
// `vi.stubGlobal("localStorage", ...)` without needing a full jsdom/window
// shim. See lib/__tests__/local-status-store.test.ts.

export type StudyStatus =
  | "not-started"
  | "called"
  | "screening"
  | "enrolled"
  | "done"
  | "not-eligible";

// Order matches prototype/net-value-model.html's click-to-cycle pattern
// exactly (its `order` array), which is also REQUIREMENTS.md must-have #6.
export const STATUS_ORDER: StudyStatus[] = [
  "not-started",
  "called",
  "screening",
  "enrolled",
  "done",
  "not-eligible",
];

export const DEFAULT_STATUS: StudyStatus = "not-started";

// Same-tab notification name a DOM component (components/status-pill.tsx)
// dispatches on `window` after a status change, so other components that
// read this store outside of props (components/ranked-table.tsx's status
// filter) can react to it. Defined here — the module that owns the "status"
// concern — rather than duplicated as a string literal in each listener/
// dispatcher. This file still touches no DOM API itself; it's a plain
// string constant, same framework-free rule as everything else here.
export const STATUS_CHANGE_EVENT = "mst:study-status-changed";

const STORAGE_KEY = "mst.studyStatus.v1";

function isStudyStatus(value: unknown): value is StudyStatus {
  return (
    typeof value === "string" &&
    (STATUS_ORDER as readonly string[]).includes(value)
  );
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

/** Cycles a status forward one step, wrapping from the last value to the first. */
export function cycleStatus(current: StudyStatus): StudyStatus {
  const i = STATUS_ORDER.indexOf(current);
  const next = i === -1 ? 0 : (i + 1) % STATUS_ORDER.length;
  return STATUS_ORDER[next];
}

/** Reads the full { studyId: status } map. Returns {} if unavailable/unset/corrupt. */
export function loadStatusMap(): Record<string, StudyStatus> {
  if (!hasLocalStorage()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, StudyStatus> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isStudyStatus(value)) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Persists the full { studyId: status } map. No-ops if localStorage is unavailable. */
export function saveStatusMap(map: Record<string, StudyStatus>): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Private-browsing quota, disabled storage, etc. — fail silently; the
    // in-memory UI state still works for the rest of this page view.
  }
}

/** Reads one study's status, defaulting to "not-started". */
export function getStoredStatus(studyId: string): StudyStatus {
  return loadStatusMap()[studyId] ?? DEFAULT_STATUS;
}

/** Writes one study's status, leaving every other study's status untouched. */
export function setStoredStatus(studyId: string, status: StudyStatus): void {
  const map = loadStatusMap();
  map[studyId] = status;
  saveStatusMap(map);
}
