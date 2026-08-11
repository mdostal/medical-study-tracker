"use client";

import { DEFAULT_PROFILE, type Assumptions, type Profile } from "@/lib/types";
import { findUsCity, US_CITIES } from "@/lib/us-cities";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { SORT_OPTIONS, type SortKey } from "@/components/ranked-table";
import { cn } from "@/lib/utils";

/** Field-by-field compare, not deep-equal on `conditions` (order-insensitive, matches app/page.tsx's badge logic). */
export function isDefaultProfile(p: Profile): boolean {
  return (
    p.bmi === DEFAULT_PROFILE.bmi &&
    p.weight_lb === DEFAULT_PROFILE.weight_lb &&
    p.sex === DEFAULT_PROFILE.sex &&
    p.age === DEFAULT_PROFILE.age &&
    p.smoker === DEFAULT_PROFILE.smoker &&
    (p.conditions?.length ?? 0) === 0
  );
}

// story: configurable-backup-care-coverage — the fictional example hubs
// this panel used to display read-only ("free coverage: SLC, SA") are gone
// (data/friend-childcare-map.json's backup_care_available ships permanently
// empty now, see that file's header comment). BackupCareHubInfo below is
// now just "a selectable hub" — every hub in the static map, not a
// pre-curated free-coverage list — and this panel lets the visitor mark
// which of THEIR OWN hubs have free coverage, never implying any hub does
// by default.

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label className="font-mono text-[0.58rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

// A selectable hub (city) from data/friend-childcare-map.json's static
// `hubs` list — just a name/code pair, no free-coverage claim attached.
// Used both as the full list of options the visitor can pick from
// (availableBackupCareHubs) and the shape of what app/page.tsx renders.
export interface BackupCareHubInfo {
  hub: string;
  city: string;
}

const HOME_BASE_DATALIST_ID = "mst-home-base-cities";

export function ProfilePanel({
  profile,
  onProfileChange,
  assumptions,
  onChange,
  sortKey,
  onSortKeyChange,
  onReset,
  availableBackupCareHubs = [],
  backupCareHubs = [],
  onBackupCareHubsChange,
}: {
  // story: editable-profile — the visitor's own BMI/weight/sex/age/smoker,
  // which drives eligibility gating in lib/scoring.ts's isEligible (bmi_min/
  // max, sex-only, smoker-only studies). Was previously hardcoded to the
  // same example values for every visitor with no way to change them.
  profile: Profile;
  onProfileChange: (next: Profile) => void;
  assumptions: Assumptions;
  onChange: (next: Assumptions) => void;
  sortKey: SortKey;
  onSortKeyChange: (key: SortKey) => void;
  onReset: () => void;
  // Every hub the visitor could pick from (data/friend-childcare-map.json's
  // hubs — not backup_care_available, which is always empty in the shipped
  // file).
  availableBackupCareHubs?: BackupCareHubInfo[];
  // story: configurable-backup-care-coverage — hub codes THIS visitor has
  // marked as their own free coverage. Defaults to [] — a fresh visitor
  // sees every checkbox unmarked and every study shows the paid rate, never
  // "free coverage", until they explicitly select one.
  backupCareHubs?: string[];
  onBackupCareHubsChange?: (next: string[]) => void;
}) {
  const setProfile = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    onProfileChange({ ...profile, [key]: value });

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

  const usingExample = isDefaultProfile(profile);

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "flex flex-wrap items-end gap-5 rounded-xl border p-4",
          usingExample
            ? "border-amber-600/40 bg-amber-500/[0.06]"
            : "border-emerald-600/30 bg-emerald-500/[0.04]",
        )}
      >
        <div className="w-full">
          <p
            className={cn(
              "font-mono text-[0.68rem] font-semibold uppercase tracking-wide",
              usingExample
                ? "text-amber-700 dark:text-amber-400"
                : "text-emerald-700 dark:text-emerald-400",
            )}
          >
            {usingExample
              ? "Using the example profile — edit it below"
              : "Your profile"}
          </p>
          <p className="mt-0.5 max-w-[70ch] text-[0.72rem] text-muted-foreground">
            {usingExample
              ? "Every study's eligibility below (BMI/weight/age/sex/smoker gates) is computed against these PLACEHOLDER values, not you. Set your real numbers so eligibility reflects your own situation."
              : "Eligibility below is computed against these values, not an example — change them any time."}
          </p>
        </div>

        <Field label="BMI">
          <Input
            type="number"
            step={0.5}
            min={10}
            max={80}
            value={profile.bmi}
            onChange={(e) => setProfile("bmi", Number(e.target.value) || 0)}
            className="w-20 font-mono tabular-nums"
          />
        </Field>

        <Field label="Weight (lb)">
          <Input
            type="number"
            step={1}
            min={50}
            value={profile.weight_lb}
            onChange={(e) =>
              setProfile("weight_lb", Number(e.target.value) || 0)
            }
            className="w-24 font-mono tabular-nums"
          />
        </Field>

        <Field label="Sex">
          <ToggleGroup
            value={[profile.sex]}
            onValueChange={(v) => {
              const next = v[0] as Profile["sex"] | undefined;
              if (next) setProfile("sex", next);
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="male" className="font-mono text-[0.68rem]">
              male
            </ToggleGroupItem>
            <ToggleGroupItem
              value="female"
              className="font-mono text-[0.68rem]"
            >
              female
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <Field label="Age (optional)">
          <Input
            type="number"
            step={1}
            min={18}
            value={profile.age ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              setProfile(
                "age",
                raw === "" ? undefined : Number(raw) || undefined,
              );
            }}
            placeholder="e.g. 32"
            className="w-20 font-mono tabular-nums"
          />
        </Field>

        <Field label="Smoker?">
          <Toggle
            pressed={Boolean(profile.smoker)}
            onPressedChange={(pressed) => setProfile("smoker", pressed)}
            variant="outline"
            size="sm"
            className="font-mono text-[0.68rem]"
          >
            {profile.smoker ? "yes" : "no"}
          </Toggle>
        </Field>

        {/* Profile.conditions exists specifically so a study gated on
            special_pop="high_cholesterol_required" (lib/scoring.ts's
            isEligible) can check it against something real instead of
            unconditionally blocking every visitor regardless of the truth. */}
        <Field label="Documented high cholesterol?">
          <Toggle
            pressed={Boolean(profile.conditions?.includes("high_cholesterol"))}
            onPressedChange={(pressed) => {
              const conditions = new Set(profile.conditions ?? []);
              if (pressed) conditions.add("high_cholesterol");
              else conditions.delete("high_cholesterol");
              setProfile("conditions", Array.from(conditions));
            }}
            variant="outline"
            size="sm"
            className="font-mono text-[0.68rem]"
          >
            {profile.conditions?.includes("high_cholesterol") ? "yes" : "no"}
          </Toggle>
        </Field>
      </div>

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
            onPressedChange={(pressed) =>
              set("has_dependents_needing_care", pressed)
            }
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

            {availableBackupCareHubs.length > 0 && (
              <Field label="Your own free coverage — cities where YOU have someone who could help">
                <ToggleGroup
                  multiple
                  value={backupCareHubs}
                  onValueChange={(next) => onBackupCareHubsChange?.(next)}
                  variant="outline"
                  size="sm"
                  className="w-full max-w-md flex-wrap"
                >
                  {availableBackupCareHubs.map((h) => (
                    <ToggleGroupItem
                      key={h.hub}
                      value={h.hub}
                      className="font-mono text-[0.62rem]"
                    >
                      {h.city}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="max-w-xs text-[0.6rem] leading-snug text-muted-foreground">
                  This is your own input, not a fact about any clinic or city —
                  mark a city only if you personally have a friend, family
                  member, or partner who could cover backup care there. Nothing
                  is marked by default.
                </p>
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
            className="flex-wrap"
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

        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
          className="font-mono text-[0.68rem]"
        >
          reset
        </Button>
      </div>
    </div>
  );
}
