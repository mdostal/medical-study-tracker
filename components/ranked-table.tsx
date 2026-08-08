"use client";

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
import { cn } from "@/lib/utils";
import type { Profile, SortKey } from "@/lib/types";

// Canonical definition lives in lib/types.ts (shared with lib/profile-store.ts
// and lib/share-link.ts for local-persistence-share-links); re-exported here
// so existing "@/components/ranked-table" imports keep working unchanged.
export type { SortKey };

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

export function RankedTable({
  eligible,
  blocked,
  profile,
  maxAwayNights,
}: {
  eligible: ScoredStudy[];
  blocked: ScoredStudy[];
  profile: Profile;
  maxAwayNights: number;
}) {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          You qualify — ranked by net value
        </h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="min-w-[1500px] text-[0.78rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  #
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Study
                </TableHead>
                <TableHead className="text-right font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Gross
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Payout
                </TableHead>
                <TableHead className="text-right font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Nights
                </TableHead>
                <TableHead className="text-right font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Trips
                </TableHead>
                <TableHead className="text-right font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Travel
                </TableHead>
                <TableHead className="text-right font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Childcare
                </TableHead>
                <TableHead className="text-right font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Net kept
                </TableHead>
                <TableHead className="text-right font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Velocity
                </TableHead>
                <TableHead className="text-right font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Downtime
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Feasibility
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground whitespace-normal">
                  Flags
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Apply
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Phone
                </TableHead>
                <TableHead className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eligible.map((s, i) => (
                <TableRow
                  key={s.id}
                  className={cn(i < 3 && "bg-emerald-500/[0.06] hover:bg-emerald-500/10")}
                >
                  <TableCell className="font-mono tabular-nums text-muted-foreground">
                    {i + 1}
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtGross(s.pay_gross, s.currency)}
                  </TableCell>
                  <TableCell className="font-mono text-[0.68rem]">
                    <div>
                      {s.payout.type} · {s.settle_days}d
                    </div>
                    {s.payout_unconfirmed && (
                      <FlagBadge>confirm on call</FlagBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {s.nights_estimated ? "~" : ""}
                    {s.inpatient_nights}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono tabular-nums">{s.trips}</span>{" "}
                    <TripBadge drivable={s.drivable} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtUSD(s.travel_cost)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {s.childcare_cost > 0 ? (
                      <>
                        {fmtUSD(s.childcare_cost)}{" "}
                        <span className="text-muted-foreground">· nanny</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">you decide</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {fmtUSD(s.net_cash)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtPerMonth(s.cash_velocity)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtPerDay(s.downtime_rate)}
                  </TableCell>
                  <TableCell>
                    <FeasibilityBadge feasibility={s.feasibility} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {s.flags
                        .filter((f) => !f.includes("payout timing"))
                        .map((f) => (
                          <FlagBadge key={f}>{f}</FlagBadge>
                        ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {s.apply_url ?? s.source_url ? (
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
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-[0.68rem] text-muted-foreground">
                    {s.phone ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusPill studyId={s.id} />
                  </TableCell>
                </TableRow>
              ))}
              {eligible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={16} className="py-6 text-center text-muted-foreground">
                    No eligible studies for the current profile and assumptions.
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
              {blocked.map((s) => (
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
              {blocked.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    Nothing excluded for the current profile.
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
