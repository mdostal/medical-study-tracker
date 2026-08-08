"use client";

import type { Assumptions } from "@/lib/types";
import { findUsCity, US_CITIES } from "@/lib/us-cities";
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

// story: generalize-profile-inputs — a hub with user-stated free backup-care
// coverage, shaped for display in the "free coverage" list below (joined
// from data/friend-childcare-map.json's hubs + backup_care_available in
// app/page.tsx, since that's where the static map is read).
export interface BackupCareHubInfo {
  hub: string;
  city: string;
  note?: string;
}

const HOME_BASE_DATALIST_ID = "mst-home-base-cities";

export function ProfilePanel({
  assumptions,
  onChange,
  sortKey,
  onSortKeyChange,
  onReset,
  backupCareHubs = [],
}: {
  assumptions: Assumptions;
  onChange: (next: Assumptions) => void;
  sortKey: SortKey;
  onSortKeyChange: (key: SortKey) => void;
  onReset: () => void;
  backupCareHubs?: BackupCareHubInfo[];
}) {
  const set = <K extends keyof Assumptions>(key: K, value: Assumptions[K]) =>
    onChange({ ...assumptions, [key]: value });

  // Any city works — a plain typed name (free string, no computed
  // distance/travel-cost estimate falls back to flight_cost) or a match
  // against the typeahead dataset (a {city, lat, lng} shape, which lets
  // lib/scoring.ts's drivable() compute a real distance). Blank = no home
  // base set at all; every study still shows, travel cost conservatively
  // assumes a flight for every trip.
  const homeBaseText =
    typeof assumptions.home_base === "string"
      ? assumptions.home_base
      : (assumptions.home_base?.city ?? "");

  const handleHomeBaseChange = (value: string) => {
    if (!value.trim()) {
      set("home_base", null);
      return;
    }
    const match = findUsCity(value);
    set("home_base", match ?? value);
  };

  return (
    <div className="flex flex-wrap items-end gap-5 rounded-xl border bg-card p-4">
      <Field label="Home base (any city, optional)">
        <Input
          list={HOME_BASE_DATALIST_ID}
          type="text"
          placeholder="e.g. Seattle, WA — blank lists every study"
          value={homeBaseText}
          onChange={(e) => handleHomeBaseChange(e.target.value)}
          className="w-52 font-mono text-[0.72rem]"
        />
        <datalist id={HOME_BASE_DATALIST_ID}>
          {US_CITIES.map((c) => (
            <option key={c.city} value={c.city} />
          ))}
        </datalist>
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

      <Field label="Dependents needing care?">
        <Toggle
          pressed={assumptions.has_dependents_needing_care}
          onPressedChange={(pressed) => set("has_dependents_needing_care", pressed)}
          variant="outline"
          size="sm"
          className="font-mono text-[0.68rem]"
        >
          {assumptions.has_dependents_needing_care ? "yes" : "no"}
        </Toggle>
      </Field>

      {/* Only shown once the visitor says they have dependents (kids, pets,
          elder care, etc.) needing coverage while away — a single visitor
          with no dependents never sees any of this and pays $0, per
          story: generalize-profile-inputs. */}
      {assumptions.has_dependents_needing_care && (
        <>
          <Field label="Backup care $/night">
            <Input
              type="number"
              step={25}
              value={assumptions.backup_care_rate_per_night}
              onChange={(e) =>
                set("backup_care_rate_per_night", Number(e.target.value) || 0)
              }
              className="w-24 font-mono tabular-nums"
            />
          </Field>

          {backupCareHubs.length > 0 && (
            <Field label="Free coverage (childcare or other backup care)">
              <div className="flex max-w-xs flex-wrap gap-1">
                {backupCareHubs.map((h) => (
                  <span
                    key={h.hub}
                    title={h.note}
                    className="rounded-md border bg-muted px-2 py-1 font-mono text-[0.62rem] text-muted-foreground"
                  >
                    {h.city}
                  </span>
                ))}
              </div>
            </Field>
          )}
        </>
      )}

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
