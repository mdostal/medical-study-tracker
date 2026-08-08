// Generic per-column sort + combinable filters for the ranked table (this
// story). Framework-free (no React/Next.js imports), matching lib/scoring.ts's
// / lib/local-status-store.ts's own convention — kept here rather than inline
// in components/ranked-table.tsx specifically so it's unit-testable via a
// plain relative import, the same way every other lib/*.test.ts in this repo
// runs (no jsdom, no "@/..." path-alias resolution needed, which isn't
// configured for vitest — see this story's test file for why that matters).

import type { ColumnId } from "./column-config-store";
import { DEFAULT_STATUS, STATUS_ORDER, type StudyStatus } from "./local-status-store";
import type { Feasibility, ScoredStudy } from "./types";

// --- Generic per-column click-to-sort ---------------------------------------

export interface TableSort {
  column: ColumnId;
  dir: "asc" | "desc";
}

const FEASIBILITY_ORDER: Record<Feasibility, number> = {
  EASY: 0,
  MODERATE: 1,
  HARD: 2,
  BLOCKED: 3,
};

type ColumnSortValue = (s: ScoredStudy, statusMap: Record<string, StudyStatus>) => number | string;

// Only columns with an unambiguous scalar value are sortable — "flags",
// "apply", "phone", and "rank" (a display index, not a study property)
// intentionally have no entry here.
const COLUMN_SORT_VALUE: Partial<Record<ColumnId, ColumnSortValue>> = {
  study: (s) => s.id,
  gross: (s) => s.pay_usd,
  payout: (s) => s.settle_days,
  nights: (s) => s.inpatient_nights ?? 0,
  trips: (s) => s.trips,
  travel: (s) => s.travel_cost,
  childcare: (s) => s.childcare_cost,
  net_cash: (s) => s.net_cash,
  velocity: (s) => s.cash_velocity,
  downtime: (s) => s.downtime_rate,
  feasibility: (s) => FEASIBILITY_ORDER[s.feasibility],
  // Pipeline order (not-started -> called -> ... ), not alphabetical —
  // STATUS_ORDER's index is the whole point of that array (see its own
  // comment in lib/local-status-store.ts).
  status: (s, statusMap) => STATUS_ORDER.indexOf(statusMap[s.id] ?? DEFAULT_STATUS),
};

export function isSortableColumn(id: ColumnId): boolean {
  return id in COLUMN_SORT_VALUE;
}

export function compareByColumn(
  a: ScoredStudy,
  b: ScoredStudy,
  column: ColumnId,
  dir: "asc" | "desc",
  statusMap: Record<string, StudyStatus>,
): number {
  const getVal = COLUMN_SORT_VALUE[column];
  if (!getVal) return 0;
  const av = getVal(a, statusMap);
  const bv = getVal(b, statusMap);
  const cmp =
    typeof av === "string" || typeof bv === "string"
      ? String(av).localeCompare(String(bv))
      : (av as number) - (bv as number);
  return dir === "asc" ? cmp : -cmp;
}

// --- Filters ------------------------------------------------------------
//
// Combinable (AND) across dimensions per this story's acceptance criteria.
// Not persisted — only column order/visibility is required to survive a
// reload (see this story's acceptance criteria); filters/sort reset to
// "show everything, default order" on every fresh page load by design, so
// the default first-load experience never changes.

export interface TableFilters {
  hub: string | "all";
  network: string | "all";
  feasibility: Feasibility | "all";
  status: StudyStatus | "all";
  eligibility: "all" | "eligible" | "not-eligible";
}

export const DEFAULT_FILTERS: TableFilters = {
  hub: "all",
  network: "all",
  feasibility: "all",
  status: "all",
  eligibility: "all",
};

export function isDefaultFilters(f: TableFilters): boolean {
  return (
    f.hub === "all" &&
    f.network === "all" &&
    f.feasibility === "all" &&
    f.status === "all" &&
    f.eligibility === "all"
  );
}

/** Hub/network/feasibility/status match — AND'd together. Eligibility is
 * handled separately by the caller since it decides which whole section
 * (qualify vs. doesn't-apply) a row belongs to, not a per-row field to test
 * here. */
export function matchesFilters(
  s: ScoredStudy,
  filters: TableFilters,
  statusMap: Record<string, StudyStatus>,
): boolean {
  if (filters.hub !== "all" && s.hub !== filters.hub) return false;
  if (filters.network !== "all" && s.network !== filters.network) return false;
  if (filters.feasibility !== "all" && s.feasibility !== filters.feasibility) return false;
  if (filters.status !== "all" && (statusMap[s.id] ?? DEFAULT_STATUS) !== filters.status) {
    return false;
  }
  return true;
}

export function filterAndSort(
  list: ScoredStudy[],
  filters: TableFilters,
  statusMap: Record<string, StudyStatus>,
  sort: TableSort | null,
): ScoredStudy[] {
  const base = list.filter((s) => matchesFilters(s, filters, statusMap));
  if (!sort) return base;
  return [...base].sort((a, b) => compareByColumn(a, b, sort.column, sort.dir, statusMap));
}
