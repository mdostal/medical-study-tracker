"use client";

import type { Assumptions } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { SORT_OPTIONS, type SortKey } from "@/components/ranked-table";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="font-mono text-[0.58rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

export function ProfilePanel({
  assumptions,
  onChange,
  sortKey,
  onSortKeyChange,
  onReset,
}: {
  assumptions: Assumptions;
  onChange: (next: Assumptions) => void;
  sortKey: SortKey;
  onSortKeyChange: (key: SortKey) => void;
  onReset: () => void;
}) {
  const set = <K extends keyof Assumptions>(key: K, value: Assumptions[K]) =>
    onChange({ ...assumptions, [key]: value });

  return (
    <div className="flex flex-wrap items-end gap-5 rounded-xl border bg-card p-4">
      <Field label="Home base">
        <ToggleGroup
          value={[assumptions.home_base]}
          onValueChange={(v) => {
            const next = v[0] as Assumptions["home_base"] | undefined;
            if (next) set("home_base", next);
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="austin" className="font-mono text-[0.72rem]">
            Austin
          </ToggleGroupItem>
          <ToggleGroupItem value="omaha" className="font-mono text-[0.72rem]">
            Omaha
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <Field label="Nanny $/night">
        <Input
          type="number"
          step={25}
          value={assumptions.nanny_rate}
          onChange={(e) => set("nanny_rate", Number(e.target.value) || 0)}
          className="w-24 font-mono tabular-nums"
        />
      </Field>

      <Field label="Flight $/trip">
        <Input
          type="number"
          step={25}
          value={assumptions.flight_cost}
          onChange={(e) => set("flight_cost", Number(e.target.value) || 0)}
          className="w-24 font-mono tabular-nums"
        />
      </Field>

      <Field label="Drive $/trip">
        <Input
          type="number"
          step={10}
          value={assumptions.drive_cost}
          onChange={(e) => set("drive_cost", Number(e.target.value) || 0)}
          className="w-24 font-mono tabular-nums"
        />
      </Field>

      <Field label="Friend covers stays ≤">
        <Input
          type="number"
          step={1}
          value={assumptions.friend_threshold_nights}
          onChange={(e) =>
            set("friend_threshold_nights", Number(e.target.value) || 0)
          }
          className="w-20 font-mono tabular-nums"
        />
      </Field>

      <Field label="Model childcare cost">
        <Toggle
          pressed={assumptions.model_childcare}
          onPressedChange={(pressed) => set("model_childcare", pressed)}
          variant="outline"
          size="sm"
          className="font-mono text-[0.68rem]"
        >
          {assumptions.model_childcare ? "on" : "off"}
        </Toggle>
      </Field>

      <Field label="Weight: net cash">
        <div className="flex w-28 items-center gap-2">
          <Slider
            min={0}
            max={100}
            step={5}
            value={Math.round(assumptions.w_net * 100)}
            onValueChange={(v) => set("w_net", (v as number) / 100)}
          />
          <span className="w-8 shrink-0 font-mono text-[0.65rem] tabular-nums text-muted-foreground">
            {Math.round(assumptions.w_net * 100)}%
          </span>
        </div>
      </Field>

      <Field label="Weight: velocity">
        <div className="flex w-28 items-center gap-2">
          <Slider
            min={0}
            max={100}
            step={5}
            value={Math.round(assumptions.w_velocity * 100)}
            onValueChange={(v) => set("w_velocity", (v as number) / 100)}
          />
          <span className="w-8 shrink-0 font-mono text-[0.65rem] tabular-nums text-muted-foreground">
            {Math.round(assumptions.w_velocity * 100)}%
          </span>
        </div>
      </Field>

      <Field label="Weight: downtime">
        <div className="flex w-28 items-center gap-2">
          <Slider
            min={0}
            max={100}
            step={5}
            value={Math.round(assumptions.w_downtime * 100)}
            onValueChange={(v) => set("w_downtime", (v as number) / 100)}
          />
          <span className="w-8 shrink-0 font-mono text-[0.65rem] tabular-nums text-muted-foreground">
            {Math.round(assumptions.w_downtime * 100)}%
          </span>
        </div>
      </Field>

      <Field label="Sort by">
        <ToggleGroup
          value={[sortKey]}
          onValueChange={(v) => {
            const next = v[0] as SortKey | undefined;
            if (next) onSortKeyChange(next);
          }}
          variant="outline"
          size="sm"
        >
          {SORT_OPTIONS.map((opt) => (
            <ToggleGroupItem
              key={opt.key}
              value={opt.key}
              className="font-mono text-[0.68rem]"
            >
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Button variant="outline" size="sm" onClick={onReset} className="font-mono text-[0.68rem]">
        reset
      </Button>
    </div>
  );
}
