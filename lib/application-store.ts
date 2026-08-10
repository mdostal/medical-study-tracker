// Application/chase-tracking persistence — localStorage adapter for the
// per-study Application record (docs/APPLICATION-TRACKING.md). Mirrors
// lib/profile-store.ts's shape/conventions: same hasLocalStorage() guard,
// same "reads/writes the global `localStorage` identifier directly"
// convention (not `window.localStorage`) so it works in real browsers and in
// test environments that stub it via `vi.stubGlobal("localStorage", ...)`
// without needing a full jsdom/window shim, and the same try/catch-never-
// throw discipline. Own storage key (separate from
// lib/profile-store.ts's mst.profileState.v1 and mst.userStudies.v1, and
// from lib/local-status-store.ts's mst.studyStatus.v1 — a different, older,
// simpler per-study status pill, not this feature) so a corrupt/cleared
// Application map never touches any of those.
//
// All shape validation/defaulting lives in lib/types.ts's
// sanitizeApplication/sanitizeApplicationsMap — shared with
// lib/share-link.ts's encodeApplicationsShareState/decodeApplicationsShareState
// exactly the way sanitizePersistedState is shared between
// lib/profile-store.ts and lib/share-link.ts's Profile encoding, so "restore
// from localStorage" and "restore from a share link" fall back to the exact
// same defaults the exact same way.
//
// Consumed by components/chase-pipeline-table.tsx, components/do-today-queue.tsx,
// components/call-log-form.tsx, and app/page.tsx's personal-overlay write-back.

import {
  createApplication,
  sanitizeApplicationsMap,
  type Application,
} from "./types";

export { createApplication } from "./types";

const STORAGE_KEY = "mst.applications.v1";

// Same cross-component same-tab-notification pattern lib/local-status-store.ts
// already established with STATUS_CHANGE_EVENT: every mounted view of this
// data (components/chase-pipeline-table.tsx, components/do-today-queue.tsx,
// app/page.tsx's ranked-table overlay) reads its own copy via useState, so
// without this, a write in one view (a call-log save, a status cycle) would
// silently go stale in every other mounted view until a full page reload.
// Dispatched from saveApplications() so every write path (upsertApplication,
// removeApplication, startApplication) notifies consistently from one place,
// not from each call site individually.
export const APPLICATION_CHANGE_EVENT = "mst:application-changed";

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function notifyApplicationsChanged(): void {
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(APPLICATION_CHANGE_EVENT));
    }
  } catch {
    // non-browser environment (tests, SSR) — no-op
  }
}

/** Reads the full { study_id: Application } map. Returns {} if unavailable/unset/corrupt. */
export function loadApplications(): Record<string, Application> {
  if (!hasLocalStorage()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return sanitizeApplicationsMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Persists the full { study_id: Application } map. No-ops if localStorage is unavailable. */
export function saveApplications(applications: Record<string, Application>): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(applications));
    notifyApplicationsChanged();
  } catch {
    // Private-browsing quota, disabled storage, etc. — fail silently; the
    // in-memory UI state still works for the rest of this page view, it
    // just won't survive a reload. Same as lib/profile-store.ts.
  }
}

/** Clears the persisted Application map, if any. */
export function clearApplications(): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Reads one study's Application record, if one has been started. */
export function getApplication(studyId: string): Application | undefined {
  return loadApplications()[studyId];
}

/**
 * Creates or replaces one study's Application record and persists the full
 * map. `application.study_id` is always forced to `studyId` (same
 * never-trust-embedded-value discipline as lib/profile-store.ts's
 * addUserStudy forcing user_added:true), so a map entry can never disagree
 * with its own key. Every other study's entry is left untouched.
 */
export function upsertApplication(
  studyId: string,
  application: Application,
): Record<string, Application> {
  const next = { ...loadApplications(), [studyId]: { ...application, study_id: studyId } };
  saveApplications(next);
  return next;
}

/** Removes one study's Application record by id and persists the result. */
export function removeApplication(studyId: string): Record<string, Application> {
  const next = loadApplications();
  delete next[studyId];
  saveApplications(next);
  return next;
}

/**
 * Convenience: start a fresh Application for a study and persist it in one
 * call (createApplication + upsertApplication). Returns the full map.
 */
export function startApplication(
  studyId: string,
  channel?: Application["channel"],
): Record<string, Application> {
  return upsertApplication(studyId, createApplication(studyId, channel));
}
