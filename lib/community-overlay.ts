// Community-corrections overlay adapter (story: community-corrections-consensus).
//
// Framework-free, matching lib/profile-store.ts's / lib/local-status-store.ts's own
// convention (no React/Next.js imports, no DOM/localStorage access -- this module
// touches neither the browser nor GitHub). It has exactly one job: given the base
// seed dataset (data/studies.seed.json, untouched/authoritative for what it covers)
// and the generated overlay (data/community-corrections.json, produced on a
// schedule by scripts/aggregate-corrections.mjs from open GitHub "data-correction"
// issues), merge the two into a display shape the UI can render -- never the other
// way around. Nothing in this module writes data/community-corrections.json and
// nothing in this module ever touches data/studies.seed.json; the two datasets stay
// separate on disk, this is purely a read-time join.
//
// No owner-approval step anywhere here or upstream of here: every status below
// (community-confirmed / disputed / unverified) is a pure function of how many
// independent open-issue reports exist and whether they agree -- see this story's
// acceptance criteria and scripts/aggregate-corrections.mjs's own header comment
// for where that computation actually happens (this module only reads the result).
//
// Deliberately decoupled from lib/types.ts's Study/ScoredStudy shape (no import of
// either): mergeCommunityOverlay below is generic over anything with an `id`, and
// the correction-eligible field taxonomy is its own small string-keyed union here
// rather than a literal path into Study's nested shape. That keeps this module
// (and scripts/aggregate-corrections.mjs, a plain Node script that can't import a
// .ts module without a build step -- see that script's own header comment) able to
// agree on a field id + a canonical string value without either side needing the
// other's type definitions.

// ---- correction-eligible field taxonomy ------------------------------------
//
// Checked against lib/types.ts's actual current Study shape (2026-08-08, this
// story's research step):
//   - "payout.settle_days" -> Payout.settle_days (number | null) -- "actual
//     settle_days", i.e. what a visitor actually experienced vs. the network's
//     published (often unknown/estimated) figure.
//   - "stays" -> Study.stays (number[] | null) -- visitors report one *total*
//     nights figure, not a per-stay breakdown; lib/scoring.ts already collapses
//     `stays` to a single `inpatient_nights` total for every other purpose
//     (display, scoring), so this mirrors that rather than asking a visitor to
//     reconstruct a multi-stay array through a no-login form.
//   - "bmi_range" -> Study.bmi_min + Study.bmi_max together (each number | null)
//     -- reported as one "min-max" value since the two bounds are only
//     meaningful as a pair.
//
// age_min/age_max, sex, smoker, and special_pop are deliberately NOT
// correction-eligible in v1: those gate eligibility itself (lib/scoring.ts's
// isEligible), and a wrong community-sourced value there risks silently
// admitting or excluding a visitor from a study they can/can't actually do.
// The three fields above are all descriptive "know your actual number" fields
// the user explicitly named, never gating.
export type CorrectionFieldId = "payout.settle_days" | "stays" | "bmi_range";

export interface CorrectionFieldDef {
  id: CorrectionFieldId;
  label: string;
  helpText: string;
  placeholder: string;
}

export const CORRECTION_FIELDS: readonly CorrectionFieldDef[] = [
  {
    id: "payout.settle_days",
    label: "Actual settle days (cash-in-hand)",
    helpText: "Days from enrollment start until ALL cash was actually in your hand.",
    placeholder: "e.g. 45",
  },
  {
    id: "stays",
    label: "Actual nights (confinement, total)",
    helpText: "Total inpatient nights you actually stayed, added up across every confinement.",
    placeholder: "e.g. 10",
  },
  {
    id: "bmi_range",
    label: "Confirmed BMI range",
    helpText: "The BMI range the network actually enforced at screening.",
    placeholder: "e.g. 18-30",
  },
];

const FIELD_IDS: ReadonlySet<string> = new Set(CORRECTION_FIELDS.map((f) => f.id));

export function isCorrectionFieldId(v: unknown): v is CorrectionFieldId {
  return typeof v === "string" && FIELD_IDS.has(v);
}

export function fieldLabel(id: CorrectionFieldId): string {
  return CORRECTION_FIELDS.find((f) => f.id === id)?.label ?? id;
}

// ---- value normalization -----------------------------------------------------
//
// Canonicalizes a visitor's raw form input into the exact string that gets
// embedded in the GitHub issue body (app/api/submit-correction/route.ts) and
// later grouped by simple string equality (scripts/aggregate-corrections.mjs).
// Returns null for anything that doesn't parse -- the caller (the form, the API
// route) rejects the submission rather than guessing.
export function normalizeCorrectionValue(field: CorrectionFieldId, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (field === "payout.settle_days" || field === "stays") {
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0 || n > 3650) return null;
    return String(Math.round(n));
  }

  // bmi_range: "18-30" | "18 - 30" | "18 to 30"
  const m = trimmed.match(/^(\d{1,3}(?:\.\d+)?)\s*(?:-|to)\s*(\d{1,3}(?:\.\d+)?)$/i);
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min <= 0 || max <= 0 || min > max || max > 100) return null;
  return `${min}-${max}`;
}

export function formatCorrectionValue(field: CorrectionFieldId, value: string): string {
  if (field === "payout.settle_days") return `${value}d`;
  if (field === "stays") return `${value} nights`;
  return `BMI ${value}`;
}

// ---- overlay file shape (data/community-corrections.json) --------------------

export interface CommunityReport {
  issue: number;
  url: string;
  submittedAt: string;
  note?: string;
}

export interface CommunityValueGroup {
  value: string; // canonical, e.g. "45" or "18-30"
  count: number;
  reports: CommunityReport[];
}

export type CommunityStatus = "community-confirmed" | "disputed" | "unverified";

export interface CommunityFieldConsensus {
  studyId: string;
  field: CorrectionFieldId;
  status: CommunityStatus;
  /** Total qualifying reports behind this result (sum of every value's count). */
  confidence: number;
  /** ALL distinct reported values, sorted by count desc -- never trimmed to one. */
  values: CommunityValueGroup[];
}

export interface CommunityCorrectionsFile {
  _comment?: string;
  generatedAt: string;
  fields: Record<string, CommunityFieldConsensus>; // key: `${studyId}::${field}`
}

export const EMPTY_COMMUNITY_FILE: CommunityCorrectionsFile = {
  generatedAt: "",
  fields: {},
};

function isCommunityReport(v: unknown): v is CommunityReport {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.issue === "number" &&
    typeof o.url === "string" &&
    typeof o.submittedAt === "string" &&
    (o.note === undefined || typeof o.note === "string")
  );
}

function isCommunityValueGroup(v: unknown): v is CommunityValueGroup {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.value === "string" &&
    typeof o.count === "number" &&
    Array.isArray(o.reports) &&
    o.reports.every(isCommunityReport)
  );
}

const STATUSES: readonly CommunityStatus[] = ["community-confirmed", "disputed", "unverified"];

function isCommunityFieldConsensus(v: unknown): v is CommunityFieldConsensus {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.studyId === "string" &&
    isCorrectionFieldId(o.field) &&
    typeof o.status === "string" &&
    (STATUSES as readonly string[]).includes(o.status) &&
    typeof o.confidence === "number" &&
    Array.isArray(o.values) &&
    o.values.every(isCommunityValueGroup)
  );
}

/**
 * Normalize arbitrary/untrusted input (the imported JSON, or a fetch result) into
 * a valid CommunityCorrectionsFile. Never throws -- a missing/corrupt/partial file
 * (e.g. before the aggregation workflow has ever run) falls back to "no community
 * data at all" rather than breaking the page, same pattern as lib/types.ts's
 * sanitizePersistedState.
 */
export function sanitizeCommunityCorrectionsFile(input: unknown): CommunityCorrectionsFile {
  if (!input || typeof input !== "object") return EMPTY_COMMUNITY_FILE;
  const o = input as Record<string, unknown>;
  const rawFields = o.fields;
  if (!rawFields || typeof rawFields !== "object") {
    return { generatedAt: typeof o.generatedAt === "string" ? o.generatedAt : "", fields: {} };
  }
  const fields: Record<string, CommunityFieldConsensus> = {};
  for (const [key, value] of Object.entries(rawFields as Record<string, unknown>)) {
    if (isCommunityFieldConsensus(value)) fields[key] = value;
  }
  return { generatedAt: typeof o.generatedAt === "string" ? o.generatedAt : "", fields };
}

function overlayKey(studyId: string, field: CorrectionFieldId): string {
  return `${studyId}::${field}`;
}

/** One study+field's consensus result, if any. */
export function getFieldConsensus(
  overlay: CommunityCorrectionsFile | null | undefined,
  studyId: string,
  field: CorrectionFieldId,
): CommunityFieldConsensus | undefined {
  if (!overlay?.fields) return undefined;
  return overlay.fields[overlayKey(studyId, field)];
}

/** All of one study's field-consensus results, if any (e.g. for a study-detail view). */
export function getStudyCorrections(
  overlay: CommunityCorrectionsFile | null | undefined,
  studyId: string,
): CommunityFieldConsensus[] {
  if (!overlay?.fields) return [];
  return Object.values(overlay.fields).filter((f) => f.studyId === studyId);
}

// ---- base-data + overlay -> display shape -------------------------------------

export type CommunityAnnotations = Partial<Record<CorrectionFieldId, CommunityFieldConsensus>>;

/**
 * Merges the overlay onto any list of base records keyed by `id` (Study[],
 * ScoredStudy[], or anything else with an id) and returns each record annotated
 * with a `.community` map of whatever correction fields have data -- never
 * mutates data/studies.seed.json's own objects (returns new objects) and never
 * silently resolves a disputed field to one value (the full CommunityFieldConsensus,
 * including every reported value, rides along unchanged).
 *
 * Generic over T rather than importing Study from lib/types.ts -- this module
 * stays a standalone, dependency-free adapter (mirroring lib/profile-store.ts's
 * "one small module owns this concern" pattern) that works the same whether it's
 * given raw seed Study rows or already-scored ScoredStudy rows.
 */
export function mergeCommunityOverlay<T extends { id: string }>(
  studies: readonly T[],
  overlay: CommunityCorrectionsFile | null | undefined,
): (T & { community: CommunityAnnotations })[] {
  const byStudy = new Map<string, CommunityAnnotations>();
  if (overlay?.fields) {
    for (const consensus of Object.values(overlay.fields)) {
      const entry = byStudy.get(consensus.studyId) ?? {};
      entry[consensus.field] = consensus;
      byStudy.set(consensus.studyId, entry);
    }
  }
  return studies.map((s) => ({ ...s, community: byStudy.get(s.id) ?? {} }));
}
