"use client";

import { useState } from "react";
import type { Study } from "@/lib/types";
import type { PullStudyResponse } from "@/app/api/pull-study/route";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// "Referral inbox: add a study by URL" (story: add-study-by-url). A visitor
// pastes a study URL; app/api/pull-study/route.ts attempts a same-origin
// server-side pre-fill for a known network (data/networks.json), or this
// form falls back to blank manual entry — either way the visitor confirms
// or edits every field before anything is added. Confirming calls
// `onAdd`, which the parent (app/page.tsx) persists via
// lib/profile-store.ts's addUserStudy — this component never touches
// localStorage itself and never sends the confirmed study anywhere but the
// parent's in-memory state + that same-origin localStorage write.

type Draft = {
  network: string;
  city: string;
  state: string;
  pay_gross: string;
  currency: "USD" | "CAD";
  age_min: string;
  age_max: string;
  bmi_min: string;
  bmi_max: string;
  nights: string;
  visits: string;
  sex: "M/F" | "male" | "female";
  smoker: "non" | "any" | "smoker-only";
  notes: string;
};

const BLANK_DRAFT: Draft = {
  network: "",
  city: "",
  state: "",
  pay_gross: "",
  currency: "USD",
  age_min: "18",
  age_max: "99",
  bmi_min: "",
  bmi_max: "",
  nights: "",
  visits: "",
  sex: "M/F",
  smoker: "any",
  notes: "",
};

function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
}

function makeStudyId(network: string, url: string): string {
  const base = (network || "study").replace(/\s+/g, "-").toLowerCase();
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  void url;
  return `user-${base}-${suffix}`;
}

export function AddStudyForm({ onAdd }: { onAdd: (study: Study) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);
  const [addedMessage, setAddedMessage] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function lookUp() {
    setLookupMessage(null);
    setAddedMessage(null);
    if (!url.trim()) {
      setLookupMessage("Paste a study URL first, or skip straight to manual entry below.");
      setShowForm(true);
      return;
    }
    setLooking(true);
    try {
      const res = await fetch("/api/pull-study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await res.json()) as PullStudyResponse;
      setLookupMessage(
        data.message ??
          (data.prefill ? "Pre-filled from the study page — check every field below." : null),
      );
      if (data.prefill) {
        setDraft((d) => ({
          ...d,
          pay_gross: data.prefill!.pay_gross != null ? String(data.prefill!.pay_gross) : d.pay_gross,
          age_min: String(data.prefill!.age_min),
          age_max: String(data.prefill!.age_max),
          bmi_min: data.prefill!.bmi_min != null ? String(data.prefill!.bmi_min) : d.bmi_min,
          bmi_max: data.prefill!.bmi_max != null ? String(data.prefill!.bmi_max) : d.bmi_max,
          nights:
            data.prefill!.stays && data.prefill!.stays.length
              ? String(data.prefill!.stays.reduce((a, b) => a + b, 0))
              : d.nights,
          visits: data.prefill!.visits != null ? String(data.prefill!.visits) : d.visits,
          notes: data.prefill!.title ?? d.notes,
        }));
      }
    } catch {
      setLookupMessage("Lookup failed — fill in the details manually below.");
    } finally {
      setLooking(false);
      setShowForm(true);
    }
  }

  function reset() {
    setUrl("");
    setDraft(BLANK_DRAFT);
    setLookupMessage(null);
    setShowForm(false);
  }

  function confirmAdd() {
    const pay_gross = numOrNull(draft.pay_gross) ?? 0;
    const study: Study = {
      id: makeStudyId(draft.network, url),
      network: draft.network.trim() || "Unverified (user-added)",
      city: draft.city.trim(),
      state: draft.state.trim(),
      hub: "",
      pay_gross,
      currency: draft.currency,
      payout: { type: "unknown", settle_days: null },
      stays: numOrNull(draft.nights) != null ? [numOrNull(draft.nights)!] : null,
      visits: numOrNull(draft.visits),
      bmi_min: numOrNull(draft.bmi_min),
      bmi_max: numOrNull(draft.bmi_max),
      age_min: numOrNull(draft.age_min) ?? 18,
      age_max: numOrNull(draft.age_max) ?? 99,
      sex: draft.sex,
      smoker: draft.smoker,
      special_pop: null,
      status: "enrolling",
      source_url: url.trim() || undefined,
      notes: draft.notes.trim() || undefined,
      user_added: true,
    };
    onAdd(study);
    setAddedMessage(`Added "${study.network}" to your list — it only lives in your own browser.`);
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between rounded-xl border bg-card p-3">
        <p className="text-xs text-muted-foreground">
          Got a referral link from a friend?{" "}
          <span className="text-foreground">Add it to your own view</span> — never sent to any server.
        </p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="font-mono text-[0.68rem]">
          + add study by URL
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Add a study by URL
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="font-mono text-[0.68rem]"
        >
          cancel
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[280px] flex-1 flex-col gap-1">
          <Label className="font-mono text-[0.58rem] uppercase tracking-wide text-muted-foreground">
            Study URL
          </Label>
          <Input
            type="url"
            placeholder="https://example-network.com/studies/123"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={lookUp} disabled={looking} className="font-mono text-[0.68rem]">
          {looking ? "looking up…" : "look up"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowForm(true)}
          className="font-mono text-[0.68rem]"
        >
          skip to manual entry
        </Button>
      </div>

      {lookupMessage && <p className="text-xs text-muted-foreground">{lookupMessage}</p>}
      {addedMessage && <p className="text-xs text-emerald-700 dark:text-emerald-400">{addedMessage}</p>}

      {showForm && (
        <div className="space-y-3 border-t pt-3">
          <p className="text-[0.7rem] text-muted-foreground">
            Confirm or edit every field — nothing is added until you click &quot;add to my
            list&quot;, and it&apos;s never sent to a server or shared with other visitors.
          </p>
          <div className="flex flex-wrap gap-3">
            <FormField label="Network / source name">
              <Input
                value={draft.network}
                onChange={(e) => set("network", e.target.value)}
                placeholder="e.g. Friend's CRO"
                className="w-48"
              />
            </FormField>
            <FormField label="City">
              <Input value={draft.city} onChange={(e) => set("city", e.target.value)} className="w-32" />
            </FormField>
            <FormField label="State">
              <Input value={draft.state} onChange={(e) => set("state", e.target.value)} className="w-20" />
            </FormField>
            <FormField label="Pay (up to)">
              <Input
                type="number"
                value={draft.pay_gross}
                onChange={(e) => set("pay_gross", e.target.value)}
                className="w-28 font-mono tabular-nums"
              />
            </FormField>
            <FormField label="Currency">
              <ToggleGroup
                value={[draft.currency]}
                onValueChange={(v) => {
                  const next = v[0] as Draft["currency"] | undefined;
                  if (next) set("currency", next);
                }}
                variant="outline"
                size="sm"
                className="flex-wrap"
              >
                <ToggleGroupItem value="USD" className="font-mono text-[0.68rem]">
                  USD
                </ToggleGroupItem>
                <ToggleGroupItem value="CAD" className="font-mono text-[0.68rem]">
                  CAD
                </ToggleGroupItem>
              </ToggleGroup>
            </FormField>
            <FormField label="Age min">
              <Input
                type="number"
                value={draft.age_min}
                onChange={(e) => set("age_min", e.target.value)}
                className="w-16 font-mono tabular-nums"
              />
            </FormField>
            <FormField label="Age max">
              <Input
                type="number"
                value={draft.age_max}
                onChange={(e) => set("age_max", e.target.value)}
                className="w-16 font-mono tabular-nums"
              />
            </FormField>
            <FormField label="BMI min">
              <Input
                type="number"
                value={draft.bmi_min}
                onChange={(e) => set("bmi_min", e.target.value)}
                className="w-16 font-mono tabular-nums"
                placeholder="?"
              />
            </FormField>
            <FormField label="BMI max">
              <Input
                type="number"
                value={draft.bmi_max}
                onChange={(e) => set("bmi_max", e.target.value)}
                className="w-16 font-mono tabular-nums"
                placeholder="?"
              />
            </FormField>
            <FormField label="Nights (stay)">
              <Input
                type="number"
                value={draft.nights}
                onChange={(e) => set("nights", e.target.value)}
                className="w-20 font-mono tabular-nums"
                placeholder="?"
              />
            </FormField>
            <FormField label="Follow-up visits">
              <Input
                type="number"
                value={draft.visits}
                onChange={(e) => set("visits", e.target.value)}
                className="w-20 font-mono tabular-nums"
                placeholder="?"
              />
            </FormField>
            <FormField label="Sex">
              <ToggleGroup
                value={[draft.sex]}
                onValueChange={(v) => {
                  const next = v[0] as Draft["sex"] | undefined;
                  if (next) set("sex", next);
                }}
                variant="outline"
                size="sm"
                className="flex-wrap"
              >
                <ToggleGroupItem value="M/F" className="font-mono text-[0.68rem]">
                  M/F
                </ToggleGroupItem>
                <ToggleGroupItem value="male" className="font-mono text-[0.68rem]">
                  M only
                </ToggleGroupItem>
                <ToggleGroupItem value="female" className="font-mono text-[0.68rem]">
                  F only
                </ToggleGroupItem>
              </ToggleGroup>
            </FormField>
            <FormField label="Smoker">
              <ToggleGroup
                value={[draft.smoker]}
                onValueChange={(v) => {
                  const next = v[0] as Draft["smoker"] | undefined;
                  if (next) set("smoker", next);
                }}
                variant="outline"
                size="sm"
                className="flex-wrap"
              >
                <ToggleGroupItem value="non" className="font-mono text-[0.68rem]">
                  non
                </ToggleGroupItem>
                <ToggleGroupItem value="any" className="font-mono text-[0.68rem]">
                  any
                </ToggleGroupItem>
                <ToggleGroupItem value="smoker-only" className="font-mono text-[0.68rem]">
                  smoker-only
                </ToggleGroupItem>
              </ToggleGroup>
            </FormField>
            <FormField label="Notes">
              <Input
                value={draft.notes}
                onChange={(e) => set("notes", e.target.value)}
                className="w-56"
              />
            </FormField>
          </div>

          <Button size="sm" onClick={confirmAdd} className="font-mono text-[0.68rem]">
            add to my list
          </Button>
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="font-mono text-[0.58rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
