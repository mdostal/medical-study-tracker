"use client";

import { useState } from "react";
import type { ScoredStudy } from "@/lib/types";
import { suggestStack, DEFAULT_WASHOUT_DAYS, type StackSuggestion } from "@/lib/stack-suggester";
import { fmtUSD } from "@/lib/format";
import { isSafeHttpUrl } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function DayRange({ start, end }: { start: number; end: number }) {
  return (
    <span className="font-mono text-[0.68rem] tabular-nums text-muted-foreground">
      day {start}–{end}
    </span>
  );
}

function ScheduleView({ schedule }: { schedule: NonNullable<StackSuggestion["schedule"]> }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[0.72rem] text-muted-foreground">
        <span>
          <b className="text-foreground">{fmtUSD(schedule.total_net_cash)}</b> combined net
        </span>
        <span aria-hidden>·</span>
        <span>
          <b className="text-foreground">{schedule.total_downtime_days}</b> total downtime days
        </span>
        <span aria-hidden>·</span>
        <span>
          ~<b className="text-foreground">{schedule.total_calendar_days}</b> calendar days end to end
        </span>
      </div>

      <ol className="space-y-2">
        {schedule.legs.map((leg, i) => (
          <li
            key={leg.study.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[0.6rem]">
                {i + 1}
              </Badge>
              <a
                href={
                  isSafeHttpUrl(leg.study.source_url)
                    ? leg.study.source_url
                    : isSafeHttpUrl(leg.study.apply_url)
                      ? leg.study.apply_url
                      : "#"
                }
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
              >
                {leg.study.id}
              </a>
              <span className="font-mono text-[0.62rem] text-muted-foreground">
                {leg.study.network} · {leg.study.city}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[0.72rem] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                {fmtUSD(leg.study.net_cash)}
              </span>
              <DayRange start={leg.start_day} end={leg.end_day} />
            </div>
            {leg.washout_after_days > 0 && (
              <div className="w-full border-t border-dashed pt-1.5 font-mono text-[0.62rem] text-amber-700 dark:text-amber-400">
                then wait {leg.washout_after_days}d washout before the next study&apos;s first
                dosing day
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function StackSuggesterPanel({ eligible }: { eligible: ScoredStudy[] }) {
  const [targetInput, setTargetInput] = useState("30000");
  const [result, setResult] = useState<StackSuggestion | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = Number(targetInput);
    if (!Number.isFinite(target) || target <= 0) return;
    setResult(suggestStack(eligible, target));
  };

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Stack suggester
        </h2>
        <p className="max-w-[70ch] text-sm text-muted-foreground">
          Give it a cash target (e.g. &ldquo;$30k by November&rdquo;) and it suggests the
          lowest-downtime combination of your eligible studies that clears it — scheduled
          sequentially so no two studies&apos; confinement windows overlap, with a{" "}
          <b className="text-foreground">real, database-enforced ~{DEFAULT_WASHOUT_DAYS}-day
          washout gap</b>{" "}
          between one study&apos;s last dosing day and the next study&apos;s first dosing day
          (cross-company — VCT/CTSdatabase tracks this regardless of which network either study
          belongs to). <b className="text-foreground">Applying</b> to multiple studies at once is
          a different thing entirely and is fine in parallel — overlapping applications across
          e.g. two sites are expected and OK; only actual dosing/confinement needs the gap.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="stack-target"
            className="font-mono text-[0.58rem] uppercase tracking-wide text-muted-foreground"
          >
            Cash target
          </Label>
          <div className="flex items-center gap-1">
            <span className="font-mono text-sm text-muted-foreground">$</span>
            <Input
              id="stack-target"
              type="number"
              min={1}
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="w-32 font-mono tabular-nums"
            />
          </div>
        </div>
        <Button type="submit" size="sm" className="font-mono text-[0.72rem]">
          Suggest stack
        </Button>
      </form>

      {result && (
        <div className="pt-1">
          {result.found && result.schedule ? (
            <ScheduleView schedule={result.schedule} />
          ) : (
            <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {result.reason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
