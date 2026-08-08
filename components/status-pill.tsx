"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_STATUS,
  cycleStatus,
  getStoredStatus,
  setStoredStatus,
  type StudyStatus,
} from "@/lib/local-status-store";

// Click-to-cycle status pill, ported from prototype/net-value-model.html's
// `.status` span + delegated click handler. Renders DEFAULT_STATUS on first
// paint (matches server-rendered markup, avoids a hydration mismatch), then
// syncs from localStorage in an effect once mounted in the browser —
// per-visitor state only, per CLAUDE.md / design-discussion.md §9.
export function StatusPill({ studyId }: { studyId: string }) {
  const [status, setStatus] = useState<StudyStatus>(DEFAULT_STATUS);

  useEffect(() => {
    setStatus(getStoredStatus(studyId));
  }, [studyId]);

  return (
    <button
      type="button"
      onClick={() => {
        setStatus((current) => {
          const next = cycleStatus(current);
          setStoredStatus(studyId, next);
          return next;
        });
      }}
      title="Click to advance status"
      className={cn(
        "select-none rounded border px-1.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-wide transition-colors",
        "border-border bg-muted text-muted-foreground hover:border-foreground/30 hover:text-foreground",
        status === "enrolled" &&
          "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        status === "screening" &&
          "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        status === "not-eligible" &&
          "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-400",
      )}
    >
      {status}
    </button>
  );
}
