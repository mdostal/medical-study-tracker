#!/usr/bin/env node
// scripts/aggregate-corrections.mjs
//
// Consensus aggregation for community-submitted data corrections (story:
// community-corrections-consensus). Reads GitHub issues labeled "data-correction"
// (created by app/api/submit-correction/route.ts on a visitor's no-login form
// submission -- see that route's own header comment for the issue body/label
// schema this script parses), groups them by study id + field, and computes:
//
//   - a single distinct reported value with >=2 issues behind it -> "community-
//     confirmed" (confidence = that count)
//   - more than one distinct reported value in the group -> "disputed" -- ALL
//     distinct values kept, each with its own count + report dates + issue
//     links, never silently resolved to one
//   - exactly one qualifying issue in the group -> "unverified" (count 1)
//
// Writes the full result to data/community-corrections.json, replacing it
// wholesale each run -- it's a generated file, never hand-edited (see that
// file's own _comment). This script NEVER reads or writes data/studies.seed.json;
// the two datasets stay separate on disk and the UI (lib/community-overlay.ts)
// joins them at render time.
//
// NO owner-approval step anywhere in this script -- per this story's explicit
// acceptance criteria, confidence is earned purely through independent
// agreement between issues. The only thing this script does *back* to GitHub
// is label (and, once confirmed, close) issues it already parsed and grouped --
// it never asks a human to approve anything, and nothing here blocks on a human
// action.
//
// Auth: uses GITHUB_TOKEN (the ambient token GitHub Actions provides to every
// workflow run -- .github/workflows/aggregate-corrections.yml grants it
// `issues: write` + `contents: write`), NOT the separate GITHUB_CORRECTIONS_TOKEN
// fine-grained PAT that app/api/submit-correction/route.ts uses. That PAT exists
// because Vercel's serverless function runs *outside* GitHub Actions and needs
// its own scoped credential to create issues from the open internet; this script
// runs *inside* a GitHub Actions job in the same repo, so the short-lived,
// automatically-scoped default token is enough -- the same least-privilege
// choice .github/workflows/daily-study-refresh.yml already makes.
//
// Fetches ALL issues (state=all, not just open) with the data-correction label:
// once an issue is labeled+closed as "community-confirmed" below, it must keep
// counting on every future run, or confidence would regress back down to 1 the
// moment a 3rd, 4th, ... agreeing report shows up after the first two got
// closed. Re-running is fully idempotent and stateless -- every run recomputes
// fresh from GitHub's current issue set rather than accumulating a running
// count file-to-file, so a since-edited/deleted issue is reflected immediately,
// with no drift.
//
// Usage:
//   GITHUB_TOKEN=... [GITHUB_REPOSITORY=owner/repo] node scripts/aggregate-corrections.mjs
//   node scripts/aggregate-corrections.mjs --local=fixture.json   # test fixture, no network call, no write
//   node scripts/aggregate-corrections.mjs --dry-run              # real fetch, print result, don't write/label

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_PATH = path.join(ROOT, "data", "community-corrections.json");

export const CORRECTION_LABEL = "data-correction";
export const CONFIRMED_LABEL = "community-confirmed";
export const DISPUTED_LABEL = "community-disputed";

// An issue carrying any of these (e.g. the owner closing + labeling an obvious
// spam/abuse issue by hand -- an optional cleanup action, never a required
// approval gate) is excluded from consensus, regardless of how it parses.
// This is the one intentionally-manual escape hatch in an otherwise fully
// automated pipeline; nothing here *requires* it to run.
export const SKIP_LABELS = ["spam", "invalid", "abuse"];

const MAX_STUDY_ID_LEN = 100;
const MAX_FIELD_LEN = 60;
const MAX_VALUE_LEN = 60;
const MAX_NOTE_LEN = 500;

function log(...a) {
  console.log("[aggregate-corrections]", ...a);
}

// GitHub Actions recognizes this exact syntax and renders it as a visible
// warning annotation on the workflow run summary -- same convention as
// scripts/pull-studies.mjs's warnAnnotation.
function warnAnnotation(msg) {
  console.log(`::warning::${msg}`);
  log("WARN", msg);
}

// -------------------- pure parsing / consensus (unit-tested) --------------------

const BLOCK_RE = /<!--mst-correction\s*([\s\S]*?)-->/;

/**
 * Extracts + validates the machine-readable block app/api/submit-correction/
 * route.ts embeds in every issue it creates. Returns null (never throws) for
 * anything malformed: no block, invalid JSON, missing/wrong-typed/oversized
 * fields, or a hand-opened issue that never had the block at all -- this is
 * the "malformed/spam submission" handling this story's test step covers.
 */
export function parseCorrectionIssue(issue) {
  const body = typeof issue.body === "string" ? issue.body : "";
  const match = body.match(BLOCK_RE);
  if (!match) return null;

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;

  const studyId = typeof data.studyId === "string" ? data.studyId.trim() : "";
  const field = typeof data.field === "string" ? data.field.trim() : "";
  const value = typeof data.value === "string" ? data.value.trim() : "";
  if (!studyId || studyId.length > MAX_STUDY_ID_LEN) return null;
  if (!field || field.length > MAX_FIELD_LEN) return null;
  if (!value || value.length > MAX_VALUE_LEN) return null;

  const note =
    typeof data.note === "string" && data.note.trim() ? data.note.trim().slice(0, MAX_NOTE_LEN) : undefined;

  const rawSubmittedAt = typeof data.submittedAt === "string" ? data.submittedAt : undefined;
  const submittedAt =
    rawSubmittedAt && !Number.isNaN(Date.parse(rawSubmittedAt)) ? rawSubmittedAt : issue.created_at;

  const labels = Array.isArray(issue.labels)
    ? issue.labels.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean)
    : [];

  return {
    studyId,
    field,
    value,
    note,
    submittedAt,
    issue: issue.number,
    url: issue.html_url,
    labels,
  };
}

/**
 * Groups parsed reports by studyId+field, computes each group's consensus
 * status, and returns both the overlay-file `fields` map and a label/close
 * plan for main() to apply back to GitHub. Pure -- no I/O, fully unit-testable
 * without a network call or a real GitHub repo.
 */
export function computeConsensus(reports) {
  const groups = new Map(); // `${studyId}::${field}` -> { studyId, field, values: Map<value, report[]> }

  for (const r of reports) {
    const key = `${r.studyId}::${r.field}`;
    if (!groups.has(key)) groups.set(key, { studyId: r.studyId, field: r.field, values: new Map() });
    const group = groups.get(key);
    if (!group.values.has(r.value)) group.values.set(r.value, []);
    group.values.get(r.value).push(r);
  }

  const fields = {};
  const labelPlan = []; // { issue, url, action: "confirm" | "dispute" }

  for (const [key, group] of groups) {
    const valueEntries = [...group.values.entries()]
      .map(([value, reps]) => ({
        value,
        count: reps.length,
        reports: reps
          .slice()
          .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
          .map((r) => ({ issue: r.issue, url: r.url, submittedAt: r.submittedAt, ...(r.note ? { note: r.note } : {}) })),
      }))
      // Most-agreed-on value first; ties broken alphabetically for a stable, deterministic order
      // (this file is committed by CI -- a stable order keeps diffs small and reviewable).
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

    const totalCount = valueEntries.reduce((sum, v) => sum + v.count, 0);

    let status;
    if (valueEntries.length === 1 && totalCount >= 2) {
      status = "community-confirmed";
      for (const r of group.values.get(valueEntries[0].value)) {
        labelPlan.push({ issue: r.issue, url: r.url, action: "confirm" });
      }
    } else if (valueEntries.length > 1) {
      // Disagreement -- per this story's explicit design, ANY distinct second value makes the
      // whole field "disputed", even if one value already has more reports than the other(s).
      // Never silently pick a majority; show every reported value instead.
      status = "disputed";
      for (const reps of group.values.values()) {
        for (const r of reps) labelPlan.push({ issue: r.issue, url: r.url, action: "dispute" });
      }
    } else {
      status = "unverified"; // exactly one report so far
    }

    fields[key] = { studyId: group.studyId, field: group.field, status, confidence: totalCount, values: valueEntries };
  }

  return { fields, labelPlan };
}

/** Drops issues that don't parse, and issues an owner has manually opted out via SKIP_LABELS. */
export function aggregateIssues(issues) {
  const reports = [];
  for (const issue of issues) {
    if (issue.pull_request) continue; // GitHub's issues endpoint also returns PRs
    const labels = Array.isArray(issue.labels)
      ? issue.labels.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean)
      : [];
    if (labels.some((l) => SKIP_LABELS.includes(l))) continue;

    const parsed = parseCorrectionIssue(issue);
    if (!parsed) {
      warnAnnotation(`Issue #${issue.number ?? "?"} has the "${CORRECTION_LABEL}" label but didn't parse as a structured correction -- skipped.`);
      continue;
    }
    reports.push(parsed);
  }
  return computeConsensus(reports);
}

// -------------------- GitHub REST I/O (not unit-tested; thin + best-effort) --------------------

const REPO = process.env.GITHUB_REPOSITORY || "mdostal/medical-study-tracker";
const [OWNER, REPO_NAME] = REPO.split("/");
const TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_CORRECTIONS_TOKEN;

async function ghFetch(pathname, init = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "medical-study-tracker-aggregate-corrections/1.0",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${init.method ?? "GET"} ${pathname} -> ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function fetchAllCorrectionIssues() {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const batch = await ghFetch(
      `/repos/${OWNER}/${REPO_NAME}/issues?state=all&labels=${encodeURIComponent(CORRECTION_LABEL)}&per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    issues.push(...batch);
    if (batch.length < 100) break;
  }
  return issues;
}

async function applyLabelPlan(labelPlan) {
  for (const { issue, action } of labelPlan) {
    const label = action === "confirm" ? CONFIRMED_LABEL : DISPUTED_LABEL;
    try {
      await ghFetch(`/repos/${OWNER}/${REPO_NAME}/issues/${issue}/labels`, {
        method: "POST",
        body: JSON.stringify({ labels: [label] }),
      });
      if (action === "confirm") {
        await ghFetch(`/repos/${OWNER}/${REPO_NAME}/issues/${issue}`, {
          method: "PATCH",
          body: JSON.stringify({ state: "closed", state_reason: "completed" }),
        });
      }
    } catch (err) {
      warnAnnotation(`Failed to label/close issue #${issue}: ${err.message}`);
    }
  }
}

async function loadIssues(localFixturePath) {
  if (localFixturePath) {
    const resolved = path.isAbsolute(localFixturePath) ? localFixturePath : path.join(ROOT, localFixturePath);
    const raw = await readFile(resolved, "utf8");
    return JSON.parse(raw);
  }
  if (!TOKEN) {
    throw new Error(
      "GITHUB_TOKEN (or GITHUB_CORRECTIONS_TOKEN) env var is required to fetch issues from GitHub -- " +
        "or pass --local=<fixture.json> to run against local test data instead.",
    );
  }
  return fetchAllCorrectionIssues();
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const localFixture = args.find((a) => a.startsWith("--local="))?.slice("--local=".length);

  const issues = await loadIssues(localFixture);
  log(`Loaded ${issues.length} "${CORRECTION_LABEL}" issue(s)${localFixture ? ` from ${localFixture}` : ""}.`);

  const { fields, labelPlan } = aggregateIssues(issues);
  const groupCount = Object.keys(fields).length;
  log(`Computed consensus for ${groupCount} study+field group(s).`);

  const output = {
    _comment:
      "GENERATED FILE -- do not hand-edit. Produced by scripts/aggregate-corrections.mjs from open+closed " +
      "GitHub issues labeled 'data-correction' (see .github/workflows/aggregate-corrections.yml). Overlays " +
      "data/studies.seed.json at render time via lib/community-overlay.ts -- never modifies that file. " +
      "No owner-approval step: every status here is earned purely through independent agreement between " +
      "issues (story: community-corrections-consensus).",
    generatedAt: new Date().toISOString(),
    fields,
  };

  if (dryRun || localFixture) {
    log("Dry run / local fixture -- not writing data/community-corrections.json or touching GitHub labels.");
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  await writeFile(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  log(`Wrote ${OUT_PATH}.`);

  await applyLabelPlan(labelPlan);
  log(`Applied labels to ${labelPlan.length} issue(s).`);
}

// Only run main() when this file is executed directly (`node scripts/aggregate-
// corrections.mjs`) -- not when lib/__tests__/aggregate-corrections.test.ts imports
// its pure functions above, same "importable without side effects" shape as
// lib/study-extract.ts's exports (consumed by both a route and a test file).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[aggregate-corrections] FATAL:", err);
    process.exitCode = 1;
  });
}
