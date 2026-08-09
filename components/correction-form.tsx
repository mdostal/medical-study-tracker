"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CORRECTION_FIELDS,
  normalizeCorrectionValue,
  type CorrectionFieldId,
} from "@/lib/community-overlay";
import type { SubmitCorrectionResponse } from "@/app/api/submit-correction/route";

// No-login data-correction form (story: community-corrections-consensus).
//
// A visitor picks a field, types the value they actually experienced, and an
// optional note -- no account, no GitHub login. Submitting posts to
// app/api/submit-correction/route.ts, which creates a public GitHub issue
// server-side using a repo-scoped token the visitor never sees. There is NO
// review step after this: once submitted, the issue is immediately eligible
// to count toward consensus the next time scripts/aggregate-corrections.mjs
// runs (see .github/workflows/aggregate-corrections.yml) -- this component's
// own copy says so explicitly, per this story's "fully transparent" design.

export function CorrectionForm({
  studyId,
  studyLabel,
  onClose,
}: {
  studyId: string;
  studyLabel: string;
  onClose: () => void;
}) {
  const [field, setField] = useState<CorrectionFieldId>(CORRECTION_FIELDS[0].id);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  // Honeypot -- real visitors never see this field (visually hidden below); a
  // bot that auto-fills every input on the page trips it. The API route
  // silently no-ops the submission when this is non-empty.
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitCorrectionResponse | null>(null);

  const fieldDef = CORRECTION_FIELDS.find((f) => f.id === field)!;
  const parsedValue = normalizeCorrectionValue(field, value);
  const showInvalid = value.trim().length > 0 && parsedValue === null;
  const canSubmit = !submitting && parsedValue !== null;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/submit-correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyId,
          network: studyLabel,
          field,
          value,
          note: note.trim() || undefined,
          website,
        }),
      });
      const data = (await res.json()) as SubmitCorrectionResponse;
      setResult(data);
      if (data.ok) {
        setValue("");
        setNote("");
      }
    } catch {
      setResult({ ok: false, message: "Network error -- try again in a bit." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-mono text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
          Report a correction -- {studyId}
        </h3>
        <Button variant="ghost" size="xs" onClick={onClose} className="font-mono text-[0.62rem]">
          close
        </Button>
      </div>

      <p className="text-[0.7rem] text-muted-foreground">
        No login needed. This creates a public GitHub issue -- nobody manually reviews it. Once{" "}
        <b className="text-foreground">2 or more people independently report the same value</b> it locks
        in as &quot;community-confirmed&quot; here. Conflicting reports are shown as &quot;disputed&quot;
        -- every value, never silently picked.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`field-${studyId}`} className="font-mono text-[0.58rem] uppercase tracking-wide text-muted-foreground">
            Field
          </Label>
          <select
            id={`field-${studyId}`}
            value={field}
            onChange={(e) => {
              setField(e.target.value as CorrectionFieldId);
              setValue("");
              setResult(null);
            }}
            className="h-8 rounded-lg border border-input bg-transparent px-2 py-1 font-mono text-[0.7rem]"
          >
            {CORRECTION_FIELDS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`value-${studyId}`} className="font-mono text-[0.58rem] uppercase tracking-wide text-muted-foreground">
            Actual value
          </Label>
          <Input
            id={`value-${studyId}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={fieldDef.placeholder}
            className="w-32 font-mono tabular-nums"
          />
        </div>

        <div className="flex min-w-[220px] flex-1 flex-col gap-1">
          <Label htmlFor={`note-${studyId}`} className="font-mono text-[0.58rem] uppercase tracking-wide text-muted-foreground">
            Note (optional)
          </Label>
          <Input
            id={`note-${studyId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. confirmed on my screening call, Aug 2026"
            className="font-mono text-[0.7rem]"
            maxLength={500}
          />
        </div>

        <Button size="sm" onClick={submit} disabled={!canSubmit} className="font-mono text-[0.68rem]">
          {submitting ? "submitting…" : "submit correction"}
        </Button>
      </div>

      <p className="text-[0.65rem] text-muted-foreground">{fieldDef.helpText}</p>
      {showInvalid && (
        <p className="text-[0.68rem] text-red-600 dark:text-red-400">
          {field === "bmi_range"
            ? 'That doesn\'t look like a range -- try e.g. "18-30".'
            : field === "bmi_min" || field === "bmi_max"
              ? "That doesn't look like a BMI number (0-100)."
              : field === "special_pop"
                ? 'That doesn\'t look like a short label -- try e.g. "overweight_obese" or "none".'
                : "That doesn't look like a whole number."}
        </p>
      )}

      {/* Honeypot -- kept off-screen, never shown to a real visitor. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-0 w-0 overflow-hidden">
        <label>
          Leave this field blank
          <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

      {result && (
        <p
          className={
            result.ok
              ? "text-[0.7rem] text-emerald-700 dark:text-emerald-400"
              : "text-[0.7rem] text-red-600 dark:text-red-400"
          }
        >
          {result.message}
          {result.ok && result.issueUrl && (
            <>
              {" "}
              <a href={result.issueUrl} target="_blank" rel="noopener noreferrer" className="underline">
                view the issue
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
