// Ranked-table column order/visibility persistence — a sibling adapter to
// lib/profile-store.ts and lib/local-status-store.ts, NOT a competing
// persistence mechanism. Same shape (reads/writes the global `localStorage`
// identifier directly, own STORAGE_KEY, fails silently), scoped to its own
// concern per lib/profile-store.ts's own header comment: "lib/local-status
// -store.ts is a separate, sibling adapter for a different concern ... not a
// violation of this boundary; the constraint is per-concern, not 'grep the
// whole repo.'" Column config is a third, distinct concern (view layout, not
// Profile/Assumptions and not per-study status), so it gets its own sibling
// module the same way — not a second field bolted onto profile-store.ts's
// PersistedState, and not a new/duplicate storage mechanism.
//
// Framework-free, matching lib/scoring.ts's / lib/local-status-store.ts's
// own convention (no React/Next.js imports).

export type ColumnId =
  | "rank"
  | "study"
  | "gross"
  | "payout"
  | "nights"
  | "trips"
  | "travel"
  | "childcare"
  | "net_cash"
  | "velocity"
  | "downtime"
  | "feasibility"
  | "flags"
  | "apply"
  | "phone"
  | "status";

export interface ColumnDef {
  id: ColumnId;
  label: string;
  /** "study" can be reordered but never hidden — an all-hidden table has no identifying column left. */
  lockedVisible?: boolean;
}

// Order here is the existing table's current column order (core-ui-ranked-
// table-profile) — the default this story must not change (see this
// story's acceptance criteria).
export const ALL_COLUMNS: ColumnDef[] = [
  { id: "rank", label: "#" },
  { id: "study", label: "Study", lockedVisible: true },
  { id: "gross", label: "Gross" },
  { id: "payout", label: "Payout" },
  { id: "nights", label: "Nights" },
  { id: "trips", label: "Trips" },
  { id: "travel", label: "Travel" },
  { id: "childcare", label: "Childcare" },
  { id: "net_cash", label: "Net kept" },
  { id: "velocity", label: "Velocity" },
  { id: "downtime", label: "Downtime" },
  { id: "feasibility", label: "Feasibility" },
  { id: "flags", label: "Flags" },
  { id: "apply", label: "Apply" },
  { id: "phone", label: "Phone" },
  { id: "status", label: "Status" },
];

const COLUMN_IDS: readonly ColumnId[] = ALL_COLUMNS.map((c) => c.id);
const LOCKED_VISIBLE: ReadonlySet<ColumnId> = new Set(
  ALL_COLUMNS.filter((c) => c.lockedVisible).map((c) => c.id),
);

export interface ColumnConfigEntry {
  id: ColumnId;
  visible: boolean;
}

/** Order of this array IS the column order; `visible` controls show/hide. */
export type ColumnConfig = ColumnConfigEntry[];

export const DEFAULT_COLUMN_CONFIG: ColumnConfig = ALL_COLUMNS.map((c) => ({
  id: c.id,
  visible: true,
}));

const STORAGE_KEY = "mst.columnConfig.v1";

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function isColumnId(value: unknown): value is ColumnId {
  return typeof value === "string" && (COLUMN_IDS as readonly string[]).includes(value);
}

/**
 * Normalize arbitrary/untrusted input (parsed JSON from localStorage) into a
 * valid ColumnConfig. Never throws. Unknown ids are dropped; duplicate ids
 * keep only the first occurrence; "study" is always forced visible; and any
 * known column missing from the input (e.g. a column added after this
 * visitor last saved their layout) is appended, visible, so it doesn't
 * silently disappear from a stale saved config.
 */
export function sanitizeColumnConfig(input: unknown): ColumnConfig {
  if (!Array.isArray(input)) return DEFAULT_COLUMN_CONFIG;

  const seen = new Set<ColumnId>();
  const out: ColumnConfig = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const id = (raw as Record<string, unknown>).id;
    if (!isColumnId(id) || seen.has(id)) continue;
    seen.add(id);
    const rawVisible = (raw as Record<string, unknown>).visible;
    const visible = typeof rawVisible === "boolean" ? rawVisible : true;
    out.push({ id, visible: LOCKED_VISIBLE.has(id) ? true : visible });
  }
  for (const id of COLUMN_IDS) {
    if (!seen.has(id)) out.push({ id, visible: true });
  }
  return out;
}

/** Reads the persisted column config. Returns DEFAULT_COLUMN_CONFIG if unavailable/unset/corrupt. */
export function loadColumnConfig(): ColumnConfig {
  if (!hasLocalStorage()) return DEFAULT_COLUMN_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMN_CONFIG;
    return sanitizeColumnConfig(JSON.parse(raw));
  } catch {
    return DEFAULT_COLUMN_CONFIG;
  }
}

/** Persists the column config. No-ops if localStorage is unavailable. */
export function saveColumnConfig(config: ColumnConfig): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Private-browsing quota, disabled storage, etc. — fail silently; the
    // in-memory UI state still works for the rest of this page view, it
    // just won't survive a reload.
  }
}

/** Clears the persisted column config, if any. */
export function clearColumnConfig(): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
