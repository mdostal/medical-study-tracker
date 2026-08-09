"use client";

import { useEffect, useMemo, useState } from "react";
import type { ScoredStudy } from "@/lib/types";
import { isEligible } from "@/lib/scoring";
import { fmtGross, fmtPerDay, fmtPerMonth, fmtUSD } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill } from "@/components/status-pill";
import { ColumnConfigMenu } from "@/components/column-config";
import { CorrectionForm } from "@/components/correction-form";
import {
  formatCorrectionValue,
  getFieldConsensus,
  type CommunityCorrectionsFile,
  type CommunityFieldConsensus,
} from "@/lib/community-overlay";
import {
  ALL_COLUMNS,
  DEFAULT_COLUMN_CONFIG,
  loadColumnConfig,
  saveColumnConfig,
  type ColumnConfig,
  type ColumnId,
} from "@/lib/column-config-store";
import { STATUS_CHANGE_EVENT, loadStatusMap, type StudyStatus } from "@/lib/local-status-store";
// Generic per-column sort + combinable filters (this story) — the pure
// logic lives in lib/table-sort-filter.ts (framework-free, unit-tested via
// a plain relative import in lib/__tests__/) rather than inline here, so it
// stays testable without rendering React / needing a "@/..." alias resolved
// in the test runner.
import {
  DEFAULT_FILTERS,
  filterAndSort,
  isDefaultFilters,
  isSortableColumn,
  matchesFilters,
  type TableFilters,
  type TableSort,
} from "@/lib/table-sort-filter";
import { cn } from "@/lib/utils";
import type { Feasibility, Profile, SortKey } from "@/lib/types";

// Canonical definition lives in lib/types.ts (shared with lib/profile-store.ts
// and lib/share-link.ts for local-persistence-share-links); re-exported here
// so existing "@/components/ranked-table" imports keep working unchanged.
export type { SortKey };
export type { TableFilters, TableSort };

// The four SCORING.md-listed quick sorts, still offered as shortcut buttons
// in the Profile panel (components/profile-panel.tsx) and still the thing
// that's persisted/shareable via lib/profile-store.ts + lib/share-link.ts —
// unchanged by this story. What's new is the table's own per-column
// click-to-sort below (lib/table-sort-filter.ts), which is local, in-table
// UI state layered on top, not a replacement of this.
export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Score" },
  { key: "net_cash", label: "Net kept" },
  { key: "cash_velocity", label: "Velocity" },
  { key: "downtime_rate", label: "Downtime" },
  { key: "pay_gross", label: "Gross pay" },
];

const SORTERS: Record<SortKey, (a: ScoredStudy, b: ScoredStudy) => number> = {
  score: (a, b) => b.score - a.score || b.cash_velocity - a.cash_velocity,
  net_cash: (a, b) => b.net_cash - a.net_cash,
  cash_velocity: (a, b) => b.cash_velocity - a.cash_velocity,
  downtime_rate: (a, b) => b.downtime_rate - a.downtime_rate,
  pay_gross: (a, b) => b.pay_usd - a.pay_usd,
};

export function sortEligible(list: ScoredStudy[], key: SortKey): ScoredStudy[] {
  return [...list].sort(SORTERS[key]);
}

const FEASIBILITY_CLASS: Record<string, string> = {
  EASY: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  MODERATE: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  HARD: "bg-red-500/15 text-red-700 dark:text-red-400",
  BLOCKED: "bg-muted text-muted-foreground",
};

function FeasibilityBadge({ feasibility }: { feasibility: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-0.5 font-mono text-[0.62rem] font-bold uppercase tracking-wide",
        FEASIBILITY_CLASS[feasibility] ?? FEASIBILITY_CLASS.BLOCKED
      )}
    >
      {feasibility}
    </span>
  );
}

function FlagBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded border border-amber-600/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[0.6rem] text-amber-700 dark:text-amber-400">
      {children}
    </span>
  );
}

// Story add-study-by-url AC4: a user-added study must be "visually distinct
// from the seed data so it's not confused with verified network listings" —
// this badge is the only thing that distinguishes an s.user_added row;
// everything else renders identically to a seed-data row.
function UserAddedBadge() {
  return (
    <span className="inline-block rounded border border-sky-600/40 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
      unverified · you added this
    </span>
  );
}

// Story community-corrections-consensus AC5/AC6: a community-confirmed value
// renders visually distinct from CRO-sourced data (never conflated -- this
// badge never replaces the base dataset's own value, it sits alongside it),
// and a disputed field always shows EVERY reported value + count, never
// silently resolved to one. `consensus` comes from data/community-
// corrections.json via lib/community-overlay.ts's getFieldConsensus --
// purely a read of an already-computed result, no logic lives here.
function CommunityBadge({ consensus }: { consensus: CommunityFieldConsensus | undefined }) {
  if (!consensus) return null;

  if (consensus.status === "community-confirmed") {
    const v = consensus.values[0];
    return (
      <span
        title={`${consensus.confidence} independent community reports agree on this value.`}
        className="inline-flex items-center gap-1 rounded border border-emerald-600/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[0.58rem] font-semibold text-emerald-700 dark:text-emerald-400"
      >
        ✓ community {formatCorrectionValue(consensus.field, v.value)} · {consensus.confidence} reports
      </span>
    );
  }

  if (consensus.status === "disputed") {
    const detail = consensus.values
      .map((v) => `${formatCorrectionValue(consensus.field, v.value)} ×${v.count}`)
      .join(", ");
    return (
      <span
        title={`Disputed -- conflicting community reports: ${detail}. Never silently resolved to one value.`}
        className="inline-flex items-center gap-1 rounded border border-red-600/40 bg-red-500/10 px-1.5 py-0.5 font-mono text-[0.58rem] font-semibold text-red-700 dark:text-red-400"
      >
        ⚠ disputed: {detail}
      </span>
    );
  }

  // unverified -- a single report so far, shown at low confidence per this
  // story's explicit spec ("1 report, unverified"), never hidden.
  const v = consensus.values[0];
  return (
    <span
      title="Only one community report so far -- not yet confirmed (needs a 2nd independent agreeing report)."
      className="inline-flex items-center gap-1 rounded border border-sky-600/40 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[0.58rem] text-sky-700 dark:text-sky-400"
    >
      1 report (unverified): {formatCorrectionValue(consensus.field, v.value)}
    </span>
  );
}

// Per-row "report a correction" trigger + inline form (story: community-
// corrections-consensus AC1). Owns its own open/closed state locally rather
// than being lifted into RankedTable's state -- each row's correction UI is
// fully independent, so there's no need to thread an "which row is open" id
// through the table component itself.
function CorrectionTrigger({ studyId, network }: { studyId: string; network: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="font-mono text-[0.58rem] text-muted-foreground underline decoration-dotted hover:text-foreground"
      >
        {open ? "cancel" : "report a correction"}
      </button>
      {open && (
        <div className="mt-2 w-[340px] max-w-[90vw]">
          <CorrectionForm studyId={studyId} studyLabel={network} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function TripBadge({ drivable }: { drivable: boolean }) {
  return (
    <span
      className={cn(
        "font-mono text-[0.62rem]",
        drivable ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
      )}
    >
      {drivable ? "drive" : "fly"}
    </span>
  );
}

function reasonFor(s: ScoredStudy, profile: Profile, maxAwayNights: number): string {
  const elig = isEligible(s, profile);
  if (!elig.ok) return elig.reason ?? "not eligible";
  if (s.feasibility === "BLOCKED") {
    return `longest single stay exceeds ${maxAwayNights} nights you can be away`;
  }
  return "excluded";
}

// --- Column render registry --------------------------------------------
//
// One entry per ColumnId (lib/column-config-store.ts) describing how to
// render its header alignment and its cell content — drives the dynamic
// header/row rendering below so column order/visibility (ColumnConfig) is a
// single source of truth instead of two hand-kept lists of JSX.

type ColumnRenderer = {
  align?: "right";
  render: (s: ScoredStudy, i: number) => React.ReactNode;
};

// Factory rather than a module-level constant: the "study", "payout",
// "nights", and "flags" renderers below need the community-corrections
// overlay (a RankedTable prop, not a module-level value) to decide whether
// to show a community badge and/or supersede a base-dataset "confirm on
// call"-style flag (story: community-corrections-consensus AC5) — everything
// else is unchanged from before that story. Called once per render via
// useMemo in RankedTable below.
function buildColumnRender(overlay: CommunityCorrectionsFile | null): Record<ColumnId, ColumnRenderer> {
  return {
  rank: {
    align: "right",
    render: (_s, i) => i + 1,
  },
  study: {
    render: (s) => {
      const bmi = getFieldConsensus(overlay, s.id, "bmi_range");
      return (
        <>
          <a
            href={s.source_url ?? s.apply_url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
          >
            {s.id}
          </a>
          <div className="font-mono text-[0.62rem] text-muted-foreground">
            {s.network} · {s.city}, {s.state}
            {s.hub ? ` · ${s.hub}` : ""}
          </div>
          {s.user_added && (
            <div className="mt-1">
              <UserAddedBadge />
            </div>
          )}
          {bmi && (
            <div className="mt-1">
              <CommunityBadge consensus={bmi} />
            </div>
          )}
          <div className="mt-1">
            <CorrectionTrigger studyId={s.id} network={s.network} />
          </div>
        </>
      );
    },
  },
  gross: {
    align: "right",
    render: (s) => fmtGross(s.pay_gross, s.currency),
  },
  payout: {
    render: (s) => {
      const consensus = getFieldConsensus(overlay, s.id, "payout.settle_days");
      // A locked-in community-confirmed value supersedes the base dataset's
      // own "confirm on call" flag (AC5) — disputed/unverified results are
      // shown *alongside* it instead, since neither of those resolve the
      // base flag's own uncertainty.
      const supersedesFlag = consensus?.status === "community-confirmed";
      return (
        <>
          <div>
            {s.payout.type} · {s.settle_days}d
          </div>
          {s.payout_unconfirmed && !supersedesFlag && <FlagBadge>confirm on call</FlagBadge>}
          {consensus && (
            <div className="mt-1">
              <CommunityBadge consensus={consensus} />
            </div>
          )}
        </>
      );
    },
  },
  nights: {
    align: "right",
    render: (s) => {
      const consensus = getFieldConsensus(overlay, s.id, "stays");
      return (
        <div className="flex flex-col items-end gap-1">
          <span>
            {s.nights_estimated ? "~" : ""}
            {s.inpatient_nights}
          </span>
          {consensus && <CommunityBadge consensus={consensus} />}
        </div>
      );
    },
  },
  trips: {
    align: "right",
    render: (s) => (
      <>
        <span className="font-mono tabular-nums">{s.trips}</span> <TripBadge drivable={s.drivable} />
      </>
    ),
  },
  travel: {
    align: "right",
    render: (s) => fmtUSD(s.travel_cost),
  },
  childcare: {
    align: "right",
    render: (s) =>
      s.backup_care_by === "paid-backup-care" ? (
        <>
          {fmtUSD(s.backup_care_cost)} <span className="text-muted-foreground">· backup care</span>
        </>
      ) : s.backup_care_by === "free-coverage" ? (
        // story: configurable-backup-care-coverage — ONLY rendered when this
        // hub is in the visitor's own persisted backup_care_hubs (never a
        // default). Never confused with short-stay-no-cost below.
        <span className="text-muted-foreground">free coverage</span>
      ) : s.backup_care_by === "short-stay-no-cost" ? (
        <span className="text-muted-foreground">no cost · short stay</span>
      ) : (
        <span className="text-muted-foreground">no dependents</span>
      ),
  },
  net_cash: {
    align: "right",
    render: (s) => (
      <span className="font-bold text-emerald-700 dark:text-emerald-400">{fmtUSD(s.net_cash)}</span>
    ),
  },
  velocity: {
    align: "right",
    render: (s) => fmtPerMonth(s.cash_velocity),
  },
  downtime: {
    align: "right",
    render: (s) => fmtPerDay(s.downtime_rate),
  },
  feasibility: {
    render: (s) => <FeasibilityBadge feasibility={s.feasibility} />,
  },
  flags: {
    render: (s) => {
      // Same supersede rule as the payout cell above (AC5): a locked-in
      // community-confirmed nights/BMI value replaces the corresponding
      // "confirm on call"-style base-dataset flag rather than showing both.
      const nightsConfirmed = getFieldConsensus(overlay, s.id, "stays")?.status === "community-confirmed";
      const bmiConfirmed = getFieldConsensus(overlay, s.id, "bmi_range")?.status === "community-confirmed";
      return (
        <div className="flex max-w-[220px] flex-wrap gap-1">
          {s.flags
            .filter((f) => !f.includes("payout timing"))
            .filter((f) => !(nightsConfirmed && f.includes("nights unknown")))
            .filter((f) => !(bmiConfirmed && f.includes("confirm BMI")))
            .map((f) => (
              <FlagBadge key={f}>{f}</FlagBadge>
            ))}
        </div>
      );
    },
  },
  apply: {
    render: (s) =>
      s.apply_url ?? s.source_url ? (
        <a
          href={s.apply_url ?? s.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-emerald-600/40 px-1.5 py-0.5 font-mono text-[0.62rem] text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
        >
          {s.apply_url ? "apply" : "source"}&nbsp;&rarr;
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  phone: {
    render: (s) => s.phone ?? "—",
  },
  status: {
    render: (s) => <StatusPill studyId={s.id} />,
  },
  };
}

const LABEL_BY_ID: Record<ColumnId, string> = Object.fromEntries(
  ALL_COLUMNS.map((c) => [c.id, c.label]),
) as Record<ColumnId, string>;

function uniqueSorted(values: (string | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort();
}

const FEASIBILITY_FILTER_OPTIONS: Feasibility[] = ["EASY", "MODERATE", "HARD", "BLOCKED"];
const STATUS_FILTER_OPTIONS: StudyStatus[] = [
  "not-started",
  "called",
  "screening",
  "enrolled",
  "done",
  "not-eligible",
];

function FilterSelect<T extends string>({
  label,
  value,
  options,
  labelFor,
  onChange,
}: {
  label: string;
  value: T | "all";
  options: readonly T[];
  labelFor?: (v: T) => string;
  onChange: (v: T | "all") => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="font-mono text-[0.58rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T | "all")}
        className="rounded-md border bg-background px-1.5 py-1 font-mono text-[0.68rem] text-foreground"
      >
        <option value="all">all</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {labelFor ? labelFor(opt) : opt}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RankedTable({
  eligible,
  blocked,
  profile,
  maxAwayNights,
  communityOverlay = null,
}: {
  eligible: ScoredStudy[];
  blocked: ScoredStudy[];
  profile: Profile;
  maxAwayNights: number;
  // Story community-corrections-consensus — data/community-corrections.json,
  // already sanitized by lib/community-overlay.ts's
  // sanitizeCommunityCorrectionsFile (app/page.tsx does this once at import
  // time). Optional/defaults to null so every existing caller/test of this
  // component keeps working unchanged with zero community badges rendered.
  communityOverlay?: CommunityCorrectionsFile | null;
}) {
  // Column render registry, rebuilt only when the overlay identity changes
  // (see buildColumnRender's own comment) — everything else about this
  // table's columns is unaffected by that story.
  const COLUMN_RENDER = useMemo(() => buildColumnRender(communityOverlay), [communityOverlay]);

  // Column order/visibility — the one piece of this story's state that
  // persists across reload, via lib/column-config-store.ts (the same
  // adapter pattern as lib/profile-store.ts). SSR/first paint renders the
  // built-in default so markup matches between server and client (no
  // hydration mismatch); the real saved config (if any) is restored client-
  // side on mount, same restore-then-persist pattern as app/page.tsx.
  const [columnConfig, setColumnConfig] = useState<ColumnConfig>(DEFAULT_COLUMN_CONFIG);
  const [hydrated, setHydrated] = useState(false);

  // Filters + generic column sort are local, in-memory UI state — not
  // persisted, so the table always starts at the existing default
  // experience (all rows, composite-score order) on a fresh load per this
  // story's acceptance criteria.
  const [filters, setFilters] = useState<TableFilters>(DEFAULT_FILTERS);
  const [tableSort, setTableSort] = useState<TableSort | null>(null);

  // Per-study status (components/status-pill.tsx), needed here only to
  // support the Status filter/sort — the pill itself still owns its own
  // read/write via lib/local-status-store.ts. Snapshotted on mount and
  // refreshed whenever a pill fires STATUS_CHANGE_EVENT.
  const [statusMap, setStatusMap] = useState<Record<string, StudyStatus>>({});

  useEffect(() => {
    setColumnConfig(loadColumnConfig());
    setStatusMap(loadStatusMap());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveColumnConfig(columnConfig);
  }, [hydrated, columnConfig]);

  useEffect(() => {
    function refresh() {
      setStatusMap(loadStatusMap());
    }
    window.addEventListener(STATUS_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(STATUS_CHANGE_EVENT, refresh);
  }, []);

  const hubOptions = useMemo(
    () => uniqueSorted([...eligible, ...blocked].map((s) => s.hub)),
    [eligible, blocked],
  );
  const networkOptions = useMemo(
    () => uniqueSorted([...eligible, ...blocked].map((s) => s.network)),
    [eligible, blocked],
  );

  // "Eligibility" filters which whole section(s) are populated — the
  // eligible/blocked split (docs/REQUIREMENTS.md must-have #5, "never bury
  // the gate") stays intact either way; this only lets a visitor narrow to
  // one side of the gate instead of always seeing both.
  const showEligibleSection = filters.eligibility !== "not-eligible";
  const showBlockedSection = filters.eligibility !== "eligible";

  const filteredEligible = useMemo(
    () => (showEligibleSection ? filterAndSort(eligible, filters, statusMap, tableSort) : []),
    [eligible, filters, statusMap, tableSort, showEligibleSection],
  );
  const filteredBlocked = useMemo(
    () => (showBlockedSection ? blocked.filter((s) => matchesFilters(s, filters, statusMap)) : []),
    [blocked, filters, statusMap, showBlockedSection],
  );

  const visibleColumns = useMemo(() => columnConfig.filter((c) => c.visible), [columnConfig]);

  function handleHeaderClick(id: ColumnId) {
    if (!isSortableColumn(id)) return;
    setTableSort((current) => {
      if (!current || current.column !== id) return { column: id, dir: "asc" };
      if (current.dir === "asc") return { column: id, dir: "desc" };
      return null; // third click on the same column clears back to the default order
    });
  }

  const filtersActive = !isDefaultFilters(filters);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            label="Hub"
            value={filters.hub}
            options={hubOptions}
            onChange={(v) => setFilters((f) => ({ ...f, hub: v }))}
          />
          <FilterSelect
            label="Network"
            value={filters.network}
            options={networkOptions}
            onChange={(v) => setFilters((f) => ({ ...f, network: v }))}
          />
          <FilterSelect
            label="Feasibility"
            value={filters.feasibility}
            options={FEASIBILITY_FILTER_OPTIONS}
            onChange={(v) => setFilters((f) => ({ ...f, feasibility: v }))}
          />
          <FilterSelect
            label="Status"
            value={filters.status}
            options={STATUS_FILTER_OPTIONS}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          />
          <FilterSelect
            label="Eligibility"
            value={filters.eligibility}
            options={["eligible", "not-eligible"] as const}
            labelFor={(v) => (v === "eligible" ? "eligible only" : "not eligible only")}
            onChange={(v) => setFilters((f) => ({ ...f, eligibility: v }))}
          />
          {filtersActive && (
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="self-end pb-1.5 font-mono text-[0.62rem] text-muted-foreground underline decoration-dotted hover:text-foreground"
            >
              clear filters
            </button>
          )}
        </div>
        <ColumnConfigMenu
          config={columnConfig}
          onChange={setColumnConfig}
          onReset={() => setColumnConfig(DEFAULT_COLUMN_CONFIG)}
        />
      </div>

      <section>
        <h2 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          You qualify — ranked by net value
        </h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="min-w-[1500px] text-[0.78rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {visibleColumns.map((col) => {
                  const sortable = isSortableColumn(col.id);
                  const align = COLUMN_RENDER[col.id].align;
                  const active = tableSort?.column === col.id;
                  return (
                    <TableHead
                      key={col.id}
                      className={cn(
                        "font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground",
                        align === "right" && "text-right",
                        col.id === "flags" && "whitespace-normal",
                      )}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => handleHeaderClick(col.id)}
                          className={cn(
                            "inline-flex items-center gap-0.5 hover:text-foreground",
                            active && "text-foreground",
                          )}
                        >
                          {LABEL_BY_ID[col.id]}
                          {active && <span aria-hidden>{tableSort!.dir === "asc" ? "▲" : "▼"}</span>}
                        </button>
                      ) : (
                        LABEL_BY_ID[col.id]
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEligible.map((s, i) => (
                <TableRow
                  key={s.id}
                  className={cn(!tableSort && i < 3 && "bg-emerald-500/[0.06] hover:bg-emerald-500/10")}
                >
                  {visibleColumns.map((col) => {
                    const align = COLUMN_RENDER[col.id].align;
                    return (
                      <TableCell
                        key={col.id}
                        className={cn(
                          align === "right" && "text-right font-mono tabular-nums",
                          col.id === "flags" && "whitespace-normal",
                        )}
                      >
                        {COLUMN_RENDER[col.id].render(s, i)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {filteredEligible.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={Math.max(visibleColumns.length, 1)}
                    className="py-6 text-center text-muted-foreground"
                  >
                    {eligible.length === 0
                      ? "No eligible studies for the current profile and assumptions."
                      : "No studies match the current filters."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Doesn&apos;t apply — eligibility / feasibility gate
        </h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="min-w-[700px] text-[0.78rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Study
                </TableHead>
                <TableHead className="text-right font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Gross
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Location
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Why
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredBlocked.map((s) => (
                <TableRow key={s.id} className="opacity-60 hover:opacity-100">
                  <TableCell className="font-medium">
                    {s.source_url ?? s.apply_url ? (
                      <a
                        href={s.source_url ?? s.apply_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-muted-foreground/40 underline-offset-2"
                      >
                        {s.id}
                      </a>
                    ) : (
                      s.id
                    )}
                    <div className="font-mono text-[0.62rem] text-muted-foreground">
                      {s.network}
                    </div>
                    {s.user_added && (
                      <div className="mt-1">
                        <UserAddedBadge />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtGross(s.pay_gross, s.currency)}
                  </TableCell>
                  <TableCell className="font-mono text-[0.68rem] text-muted-foreground">
                    {s.city}, {s.state}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {reasonFor(s, profile, maxAwayNights)}
                  </TableCell>
                </TableRow>
              ))}
              {filteredBlocked.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    {blocked.length === 0
                      ? "Nothing excluded for the current profile."
                      : "No excluded studies match the current filters."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
