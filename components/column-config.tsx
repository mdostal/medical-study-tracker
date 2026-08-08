"use client";

import { useEffect, useRef, useState } from "react";
import { ALL_COLUMNS, type ColumnConfig, type ColumnId } from "@/lib/column-config-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LABEL_BY_ID: Record<ColumnId, string> = Object.fromEntries(
  ALL_COLUMNS.map((c) => [c.id, c.label]),
) as Record<ColumnId, string>;

const LOCKED_VISIBLE = new Set(ALL_COLUMNS.filter((c) => c.lockedVisible).map((c) => c.id));

/**
 * Column order/visibility control for the ranked table — reorder (up/down)
 * and show/hide any column, per this story's acceptance criteria. Purely a
 * controlled component: all state (and its localStorage persistence, via
 * lib/column-config-store.ts) lives in the parent (RankedTable).
 */
export function ColumnConfigMenu({
  config,
  onChange,
  onReset,
}: {
  config: ColumnConfig;
  onChange: (next: ColumnConfig) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= config.length) return;
    const next = [...config];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function toggleVisible(index: number) {
    const entry = config[index];
    if (LOCKED_VISIBLE.has(entry.id)) return;
    onChange(config.map((c, i) => (i === index ? { ...c, visible: !c.visible } : c)));
  }

  const visibleCount = config.filter((c) => c.visible).length;

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="font-mono text-[0.68rem]"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        columns ({visibleCount}/{config.length})
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-60 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
              Columns
            </span>
            <button
              type="button"
              onClick={onReset}
              className="font-mono text-[0.6rem] text-muted-foreground underline decoration-dotted hover:text-foreground"
            >
              reset
            </button>
          </div>
          <ul className="max-h-72 space-y-0.5 overflow-y-auto">
            {config.map((entry, i) => {
              const locked = LOCKED_VISIBLE.has(entry.id);
              const label = LABEL_BY_ID[entry.id] ?? entry.id;
              return (
                <li
                  key={entry.id}
                  className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={entry.visible}
                    disabled={locked}
                    onChange={() => toggleVisible(i)}
                    aria-label={locked ? `${label} (always visible)` : `Show ${label} column`}
                    className="h-3 w-3 accent-foreground disabled:opacity-40"
                  />
                  <span
                    className={cn(
                      "flex-1 truncate font-mono text-[0.68rem]",
                      !entry.visible && "text-muted-foreground",
                    )}
                  >
                    {label}
                  </span>
                  <button
                    type="button"
                    aria-label={`Move ${label} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="rounded px-1 text-muted-foreground hover:text-foreground disabled:opacity-25"
                  >
                    &uarr;
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${label} down`}
                    disabled={i === config.length - 1}
                    onClick={() => move(i, 1)}
                    className="rounded px-1 text-muted-foreground hover:text-foreground disabled:opacity-25"
                  >
                    &darr;
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
