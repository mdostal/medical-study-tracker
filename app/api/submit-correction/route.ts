// Server-side GitHub issue creation for the no-login corrections form
// (story: community-corrections-consensus, components/correction-form.tsx).
//
// A visitor never touches GitHub directly -- this route holds the one
// repo-scoped credential the whole feature needs and creates a structured,
// labeled GitHub issue on their behalf. scripts/aggregate-corrections.mjs
// (run on a schedule by .github/workflows/aggregate-corrections.yml) later
// reads these issues and computes consensus -- there is NO owner-review step
// anywhere between this route and that script; a successfully created issue
// is immediately eligible to count toward consensus on the next scheduled run.
//
// Auth: GITHUB_CORRECTIONS_TOKEN (Vercel env var, see this story's report for
// exactly how to create/scope it) -- a GitHub fine-grained PAT scoped to THIS
// repo only, with the single permission "Issues: Read and write". Nothing
// else (no contents, no admin, no other repos). Never logged, never echoed
// back in any response, never sent to the client in any form.
//
// Issue body schema (parsed by scripts/aggregate-corrections.mjs's
// parseCorrectionIssue -- keep the two in sync if this changes): a short
// human-readable summary, followed by a `<!--mst-correction {...} -->` HTML
// comment carrying the exact {studyId, field, value, note?, submittedAt}
// JSON the aggregation script groups on. The comment form keeps the issue
// itself readable on github.com (this story's "fully transparent" design
// goal) while still giving the aggregator a byte-exact, hand-edit-resistant
// block to parse instead of scraping the human prose.

import { NextResponse } from "next/server";
import {
  CORRECTION_FIELDS,
  isCorrectionFieldId,
  normalizeCorrectionValue,
  type CorrectionFieldId,
} from "@/lib/community-overlay";

const REPO = process.env.GITHUB_REPO || "mdostal/medical-study-tracker";
const CORRECTION_LABEL = "data-correction";

const MAX_STUDY_ID_LEN = 100;
const MAX_NETWORK_LEN = 120;
const MAX_NOTE_LEN = 500;
const STUDY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;

export interface SubmitCorrectionResponse {
  ok: boolean;
  message: string;
  issueUrl?: string;
}

function respond(body: SubmitCorrectionResponse, status: number) {
  return NextResponse.json(body, { status });
}

// ---- best-effort per-IP rate limit --------------------------------------------
//
// Deliberately simple, in-memory, per-serverless-instance -- per this story's
// risk register: "Out of scope to fully solve in v1 given no-account
// constraint, ... rate-limit the API route per IP." A cold-start or a
// different region's instance resets this; it slows down a casual spammer
// without pretending to be a real distributed limiter (that would need
// Vercel KV/Upstash, a new dependency out of scope for this story).
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const submissionLog = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (submissionLog.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  submissionLog.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX;
}

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// Very rough spam heuristic: a "note" stuffed with multiple links reads as
// link-spam far more often than a genuine correction note. Not a full spam
// solution (see risk register) -- just a cheap, honest-submitter-safe filter.
function looksLikeLinkSpam(note: string): boolean {
  const linkCount = (note.match(/https?:\/\//gi) ?? []).length;
  return linkCount >= 3;
}

interface CorrectionPayload {
  studyId: string;
  network?: string;
  field: CorrectionFieldId;
  value: string; // raw, normalized below
  note?: string;
}

function parsePayload(body: unknown): { payload: CorrectionPayload; honeypotFilled: boolean } | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;

  const honeypot = typeof o.website === "string" ? o.website.trim() : "";

  const studyId = typeof o.studyId === "string" ? o.studyId.trim() : "";
  const network = typeof o.network === "string" ? o.network.trim().slice(0, MAX_NETWORK_LEN) : undefined;
  const field = o.field;
  const value = typeof o.value === "string" ? o.value.trim() : "";
  const note = typeof o.note === "string" ? o.note.trim().slice(0, MAX_NOTE_LEN) : undefined;

  if (!studyId || studyId.length > MAX_STUDY_ID_LEN || !STUDY_ID_RE.test(studyId)) return null;
  if (!isCorrectionFieldId(field)) return null;
  if (!value) return null;

  return { payload: { studyId, network, field, value, note: note || undefined }, honeypotFilled: honeypot.length > 0 };
}

function issueBody(payload: CorrectionPayload, canonicalValue: string, submittedAt: string): string {
  const fieldDef = CORRECTION_FIELDS.find((f) => f.id === payload.field);
  const lines = [
    "### Data correction report",
    "",
    `**Study:** ${payload.studyId}${payload.network ? ` (${payload.network})` : ""}`,
    `**Field:** ${fieldDef?.label ?? payload.field} (\`${payload.field}\`)`,
    `**Reported value:** ${canonicalValue}`,
  ];
  if (payload.note) lines.push(`**Note:** ${payload.note}`);
  lines.push(
    "",
    "<!--mst-correction",
    JSON.stringify({
      studyId: payload.studyId,
      field: payload.field,
      value: canonicalValue,
      note: payload.note,
      submittedAt,
    }),
    "-->",
    "",
    "---",
    "Submitted via the no-login correction form. This issue is processed automatically by the consensus " +
      "aggregation job (scripts/aggregate-corrections.mjs) -- nobody manually reviews it. Once 2 or more " +
      "independent reports agree on the same value it locks in as community-confirmed; conflicting reports " +
      "are shown as disputed, with every reported value visible.",
  );
  return lines.join("\n");
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return respond({ ok: false, message: "Invalid request body." }, 400);
  }

  const parsed = parsePayload(rawBody);
  if (!parsed) {
    return respond(
      { ok: false, message: "Missing or invalid study id / field / value." },
      400,
    );
  }

  // Honeypot: a real visitor never sees or fills this field (components/
  // correction-form.tsx keeps it visually hidden). A bot that auto-fills every
  // input trips it. Respond as if it succeeded -- never tip off the bot that
  // it was detected -- but skip creating an issue entirely.
  if (parsed.honeypotFilled) {
    return respond({ ok: true, message: "Thanks -- submission received." }, 200);
  }

  const { payload } = parsed;

  const canonicalValue = normalizeCorrectionValue(payload.field, payload.value);
  if (!canonicalValue) {
    const fieldDef = CORRECTION_FIELDS.find((f) => f.id === payload.field);
    return respond(
      {
        ok: false,
        message: `That doesn't look like a valid value for "${fieldDef?.label ?? payload.field}" -- try "${fieldDef?.placeholder ?? ""}".`,
      },
      400,
    );
  }

  if (payload.note && looksLikeLinkSpam(payload.note)) {
    return respond({ ok: false, message: "That note looks like spam -- remove the links and try again." }, 400);
  }

  const ip = clientIp(request);
  if (isRateLimited(ip)) {
    return respond(
      { ok: false, message: "Too many submissions from this connection recently -- try again in a few minutes." },
      429,
    );
  }

  const token = process.env.GITHUB_CORRECTIONS_TOKEN;
  if (!token) {
    // Never expose *why* to the client beyond "not enabled yet" -- this is a
    // deployment-configuration gap (see this story's report), not something a
    // visitor did wrong.
    console.error(
      "[submit-correction] GITHUB_CORRECTIONS_TOKEN is not configured -- corrections submissions are disabled.",
    );
    return respond(
      { ok: false, message: "Corrections submissions aren't enabled on this deployment yet -- check back soon." },
      503,
    );
  }

  const submittedAt = new Date().toISOString();
  const title = `[correction] ${payload.studyId} · ${payload.field}: ${canonicalValue}`;
  const body = issueBody(payload, canonicalValue, submittedAt);
  const labels = [CORRECTION_LABEL, `study:${payload.studyId}`, `field:${payload.field}`];

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "medical-study-tracker-submit-correction/1.0",
      },
      body: JSON.stringify({ title, body, labels }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      // Deliberately do not include the response body in anything sent to the
      // client -- GitHub error payloads can echo back request details we'd
      // rather not surface, and never risk echoing anything token-adjacent.
      console.error(`[submit-correction] GitHub issue creation failed: ${res.status}`);
      return respond(
        { ok: false, message: "Couldn't submit your correction right now -- try again in a bit." },
        502,
      );
    }

    const created = (await res.json()) as { html_url?: string };
    return respond(
      {
        ok: true,
        message: "Thanks -- your correction is now a public GitHub issue and will count toward consensus.",
        issueUrl: created.html_url,
      },
      200,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    console.error(`[submit-correction] Network error creating issue: ${reason}`);
    return respond(
      { ok: false, message: "Couldn't reach GitHub right now -- try again in a bit." },
      502,
    );
  }
}
