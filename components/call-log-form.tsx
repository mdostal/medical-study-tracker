"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Application, PayoutType } from "@/lib/types";
import { createApplication, getApplication, upsertApplication } from "@/lib/application-store";
import {
  parseCallLogFormInputs,
  buildCallLogUpdate,
  shareableCallLogFields,
  type CallLogFormInputs,
} from "@/lib/personal-overlay";
import type { CorrectionFieldId } from "@/lib/community-overlay";
import type { SubmitCorrectionResponse } from "@/app/api/submit-correction/route";

// Call-log capture form -- the 5-question write-back this story exists for
// (docs/APPLICATION-TRACKING.md "Call-log capture — the 5 questions"). Meant
// to be mounted from a study's per-study drawer (story: chase-pipeline-view)
// -- this component only needs a `studyId`, so it has no dependency on that
// drawer existing yet, same "ships as a standalone, reusable module" posture
// as lib/application-store.ts before chase-pipeline-view landed.
//
// Saving writes ONLY to this visitor's own localStorage (via
// lib/application-store.ts's upsertApplication) -- data/studies.seed.json
// and data/community-corrections.json are never touched here (AC4). The
// ONLY path from this form to anywhere else is the explicit, opt-in "share
// with everyone" button per shareable field below, which reuses the
// EXISTING /api/submit-correction route (community-corrections-consensus) --
// never automatic, never bulk (AC5).
//
// Every placeholder/example value below is a generic, made-up number --
// never real personal data (see this story's PII acceptance criterion).

// Re-exported for existing importers (app/page.tsx) -- now defined and
// dispatched centrally in lib/application-store.ts so every write path
// (call-log saves here, status cycles in chase-pipeline-table.tsx, stale
// flips in do-today-queue.tsx) notifies consistently, not just this form.
export { APPLICATION_CHANGE_EVENT } from "@/lib/application-store";

const PAYOUT_TYPE_OPTIONS: { value: PayoutType; label: string }[] = [
  { value: "lump_end", label: "Lump sum, end of confinement" },
  { value: "prorated", label: "Per-visit / prorated" },
  { value: "milestone", label: "Milestone payments" },
  { value: "unknown", label: "Not sure yet" },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_INPUTS: Omit<CallLogFormInputs, "date"> = {
  who: "",
  summary: "",
  totalNights: "",
  stayCount: "",
  payoutType: "unknown",
  settleDays: "",
  payoutNote: "",
  washoutDays: "",
  bmiOk: "unset",
  stipendPerVisit: "",
};

export function CallLogForm({
  studyId,
  studyLabel,
  kind = "call",
  onSaved,
  onClose,
}: {
  studyId: string;
  studyLabel?: string;
  /** "update" for form/syndicated-apply channels, where there was never a phone call to log. */
  kind?: "call" | "update";
  onSaved?: (application: Application) => void;
  onClose?: () => void;
}) {
  const [inputs, setInputs] = useState<CallLogFormInputs>({ date: todayISO(), ...EMPTY_INPUTS });
  const [saved, setSaved] = useState<Application | null>(null);
  const [shareStatus, setShareStatus] = useState<
    Partial<Record<CorrectionFieldId, "sharing" | SubmitCorrectionResponse>>
  >({});

  function set<K extends keyof CallLogFormInputs>(key: K, value: CallLogFormInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  const canSave = inputs.who.trim().length > 0 && inputs.summary.trim().length > 0;

  function save() {
    if (!canSave) return;
    const answers = parseCallLogFormInputs(inputs);
    // getApplication already sanitizes via lib/application-store.ts's
    // loadApplications -> sanitizeApplicationsMap, so `current` always has
    // every required Application field (confirmation/contact/call_log/
    // confirmed) even on a brand-new study -- createApplication (the same
    // one lib/application-store.ts re-exports from lib/types.ts) covers the
    // very-first-ever-call case where no Application exists yet.
    const current = getApplication(studyId) ?? createApplication(studyId);
    const updated = buildCallLogUpdate(current, answers);
    upsertApplication(studyId, updated);
    setSaved(updated);
    setShareStatus({});
    // Reset the call-specific fields for a possible next entry, but keep
    // today's date pre-filled -- matches components/correction-form.tsx's
    // own "clear the form on a successful submit" pattern.
    setInputs({ date: todayISO(), ...EMPTY_INPUTS });
    // upsertApplication -> saveApplications already dispatches
    // APPLICATION_CHANGE_EVENT (lib/application-store.ts) -- no manual
    // dispatch needed here.
    onSaved?.(updated);
  }

  async function share(field: CorrectionFieldId, value: string) {
    setShareStatus((s) => ({ ...s, [field]: "sharing" }));
    try {
      const res = await fetch("/api/submit-correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studyId, network: studyLabel, field, value }),
      });
      const data = (await res.json()) as SubmitCorrectionResponse;
      setShareStatus((s) => ({ ...s, [field]: data }));
    } catch {
      setShareStatus((s) => ({
        ...s,
        [field]: { ok: false, message: "Network error -- try again in a bit." },
      }));
    }
  }

  const shareable = saved ? shareableCallLogFields(saved) : [];

  return (
    <div className="space-y-3 rounded-lg border border-dashed bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-mono text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
          {kind === "call" ? "Log a call" : "Log an update"} -- {studyId}
        </h3>
        {onClose && (
          <Button variant="ghost" size="xs" onClick={onClose} className="font-mono text-[0.62rem]">
            close
          </Button>
        )}
      </div>

      <p className="text-[0.7rem] text-muted-foreground">
        Saved here updates <b className="text-foreground">only your own</b> ranking, immediately, in
        your browser&apos;s local storage. Nothing here is sent anywhere unless you explicitly click a
        &quot;share&quot; button below after saving.
      </p>

      {/* Call metadata */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="Date">
          <Input
            type="date"
            value={inputs.date}
            onChange={(e) => set("date", e.target.value)}
            className="font-mono text-[0.7rem]"
          />
        </Field>
        <Field label="Who (role, not a name)">
          <Input
            value={inputs.who}
            onChange={(e) => set("who", e.target.value)}
            placeholder={kind === "call" ? "e.g. clinic coordinator" : "e.g. myself, via the form"}
            className="font-mono text-[0.7rem]"
          />
        </Field>
        <Field label="Summary">
          <Input
            value={inputs.summary}
            onChange={(e) => set("summary", e.target.value)}
            placeholder={
              kind === "call"
                ? "e.g. confirmed screening slot, went over the 5 questions"
                : "e.g. submitted the registration form, no confirmation email yet"
            }
            className="font-mono text-[0.7rem]"
          />
        </Field>
      </div>

      {/* Question 1: nights + stays */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Total nights (confinement)">
          <Input
            inputMode="numeric"
            value={inputs.totalNights}
            onChange={(e) => set("totalNights", e.target.value)}
            placeholder="e.g. 8"
            className="font-mono tabular-nums"
          />
        </Field>
        <Field label="Separate stays">
          <Input
            inputMode="numeric"
            value={inputs.stayCount}
            onChange={(e) => set("stayCount", e.target.value)}
            placeholder="e.g. 1"
            className="font-mono tabular-nums"
          />
        </Field>

        {/* Question 2: payout type + timing */}
        <Field label="How they pay">
          <select
            value={inputs.payoutType}
            onChange={(e) => set("payoutType", e.target.value as PayoutType)}
            className="h-8 rounded-lg border border-input bg-transparent px-2 py-1 font-mono text-[0.7rem]"
          >
            {PAYOUT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Days to cash-in-hand">
          <Input
            inputMode="numeric"
            value={inputs.settleDays}
            onChange={(e) => set("settleDays", e.target.value)}
            placeholder="e.g. 45"
            className="font-mono tabular-nums"
          />
        </Field>
      </div>

      <Field label="Payout detail (optional -- e.g. 'after last visit, ACH')">
        <Input
          value={inputs.payoutNote}
          onChange={(e) => set("payoutNote", e.target.value)}
          placeholder="e.g. end of confinement, mailed check"
          className="font-mono text-[0.7rem]"
        />
      </Field>

      {/* Questions 3-5: washout, BMI fit, stipend */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Washout days">
          <Input
            inputMode="numeric"
            value={inputs.washoutDays}
            onChange={(e) => set("washoutDays", e.target.value)}
            placeholder="e.g. 30"
            className="font-mono tabular-nums"
          />
        </Field>
        <Field label="BMI fits?">
          <select
            value={inputs.bmiOk}
            onChange={(e) => set("bmiOk", e.target.value as CallLogFormInputs["bmiOk"])}
            className="h-8 rounded-lg border border-input bg-transparent px-2 py-1 font-mono text-[0.7rem]"
          >
            <option value="unset">not asked</option>
            <option value="yes">yes, fits</option>
            <option value="no">no, doesn&apos;t fit</option>
          </select>
        </Field>
        <Field label="Stipend / visit ($)">
          <Input
            inputMode="numeric"
            value={inputs.stipendPerVisit}
            onChange={(e) => set("stipendPerVisit", e.target.value)}
            placeholder="e.g. 50"
            className="font-mono tabular-nums"
          />
        </Field>
      </div>

      <Button size="sm" onClick={save} disabled={!canSave} className="font-mono text-[0.68rem]">
        {kind === "call" ? "save call log entry" : "save update"}
      </Button>

      {saved && (
        <div className="space-y-2 rounded border bg-background p-2">
          <p className="text-[0.7rem] text-emerald-700 dark:text-emerald-400">
            Saved to your private {kind === "call" ? "call log" : "update log"} for {studyId} --
            your own ranking above now uses these confirmed values.
          </p>
          {shareable.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                Optional -- share with everyone else
              </p>
              {shareable.map((row) => {
                const status = shareStatus[row.field];
                return (
                  <div key={row.field} className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.7rem] text-muted-foreground">
                      {row.label}: <b className="text-foreground">{row.value}</b>
                    </span>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => share(row.field, row.value)}
                      disabled={status === "sharing"}
                      className="font-mono text-[0.62rem]"
                    >
                      {status === "sharing" ? "sharing…" : "share with everyone"}
                    </Button>
                    {status && status !== "sharing" && (
                      <span
                        className={
                          status.ok
                            ? "text-[0.65rem] text-emerald-700 dark:text-emerald-400"
                            : "text-[0.65rem] text-red-600 dark:text-red-400"
                        }
                      >
                        {status.message}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="font-mono text-[0.58rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
