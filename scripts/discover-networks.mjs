#!/usr/bin/env node
// scripts/discover-networks.mjs
//
// Directory-gap discovery puller (story: directory-gap-discovery).
//
// jalr.org ("Just Another Lab Rat!") is a community-run directory + forum that lists Phase-1
// clinics nationally, plainly stated on the site as "only a resource guide" — it is NOT a
// structured per-study data source (no pay figures, no compensation math, no eligibility
// criteria comparable to a CRO's own site). Per docs/DATA-INTEGRITY.md's anti-fabrication rule,
// this script therefore treats it as a DISCOVERY source only: it finds clinic/network NAMES and
// LOCATIONS that aren't yet in data/networks.json, and records them as "discovered — not yet
// verified" entries with a link back to the JALR listing page. It never invents pay, eligibility,
// nights, or any other study-level field for a discovered entry — that's exactly the failure mode
// docs/DATA-INTEGRITY.md's "incident that made these rules" describes.
//
// Source structure (confirmed live 2026-08-08 via plain fetch — jalr.org's homepage is static
// server-rendered HTML, no JS rendering needed unlike the CRO portals in pull-studies.mjs): the
// "Major Phase I Clinics in the US" section is a real HTML table (#tablepress-1) with 4 columns
// per row, forming two independent (state/city, clinic-link) pairs side by side:
//   <td class="column-1"><b>ST</b> <i>City</i></td><td class="column-2"><a href="...">Name</a></td>
//   <td class="column-3"><b>ST</b> <i>City</i></td><td class="column-4"><a href="...">Name</a></td>
// column-3/4 are sometimes empty (odd-length list). Cells are read in document order as
// (location, link) pairs regardless of column number, which naturally handles that.
//
// A row is EXCLUDED from discovery (not a candidate) when:
//   - its (city, state) already matches a site already listed under some network in
//     data/networks.json (case-insensitive) -- already covered, not a gap.
//   - its link has no real href (`href="#"`, empty, or missing) -- Rule 1 of
//     docs/DATA-INTEGRITY.md requires a real, resolving, per-listing URL; a dead placeholder link
//     doesn't qualify even for a "go check this yourself" pointer.
//   - its link path contains "/patient_clinics/" -- JALR's own URL structure marks it as a
//     Phase II-IV patient-population clinic, out of this tool's Phase-1/healthy-volunteer scope
//     (same "deprioritize" treatment data/networks.json already gives DM Clinical, Innovaderm,
//     KGK Science).
//
// Surviving rows are grouped by clinic name (case-insensitive) into one discovered entry per
// name, each carrying every new site found for it, and written to a *separate* top-level
// `discovered_networks` array in data/networks.json — never merged into the confirmed `networks`
// array, so a discovered entry can never be mistaken for (or silently upgrade) a verified one.
// Promoting an entry from `discovered_networks` to `networks` is a manual step: someone actually
// calls/visits the clinic and confirms it the way every existing `networks` entry was confirmed.
//
// Usage:
//   node scripts/discover-networks.mjs             # crawl, diff, write data/networks.json
//   node scripts/discover-networks.mjs --dry-run    # crawl + print the diff, don't write

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const NETWORKS_PATH = path.join(ROOT, "data", "networks.json");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0 Safari/537.36 medical-study-tracker-discover/1.0 (+https://github.com/; " +
  "occasional discovery pass, respectful cadence)";

const JALR_URL = "https://jalr.org/";

const DRY_RUN = process.argv.includes("--dry-run");

function log(...a) {
  console.log("[discover-networks]", ...a);
}

function warnAnnotation(msg) {
  console.log(`::warning::${msg}`);
  log("WARN", msg);
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "’")
    .replace(/&#8211;/g, "–")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, " "));
}

// Known typos/abbreviations in JALR's own source table (confirmed live 2026-08-08 by reading the
// raw HTML directly) -- corrected here rather than carried verbatim, since these are plainly
// city-name errors/shorthand on JALR's end, not a fact about the clinic being discovered.
const CITY_FIXES = {
  graysake: "Grayslake", // IL -- AbbVie's row; real suburb is "Grayslake"
  "ny city": "New York City",
};

function fixCity(city) {
  return CITY_FIXES[city.toLowerCase()] ?? city;
}

/** Parses the JALR homepage's "Major Phase I Clinics in the US" table
 * (#tablepress-1) into a flat list of {name, city, state, source_url}. */
function parseJalrClinics(html) {
  const tableMatch = html.match(
    /<table id="tablepress-1"[^>]*>([\s\S]*?)<\/table>/
  );
  if (!tableMatch) {
    throw new Error("tablepress-1 (Major Phase I Clinics table) not found in jalr.org homepage HTML");
  }
  const tableHtml = tableMatch[1];

  // Read every <td class="column-N">...</td> in document order.
  const cellRe = /<td class="column-\d">([\s\S]*?)<\/td>/g;
  const cells = [];
  let m;
  while ((m = cellRe.exec(tableHtml))) cells.push(m[1]);

  const clinics = [];
  // Cells alternate (location, link) regardless of which column-N they came from, since
  // column-1/2 and column-3/4 are just two side-by-side (location, link) pairs per row.
  for (let i = 0; i + 1 < cells.length; i += 2) {
    const locCell = cells[i];
    const linkCell = cells[i + 1];

    const stateMatch = locCell.match(/<b>([A-Z]{2})<\/b>/);
    const cityMatch = locCell.match(/<i>([\s\S]*?)<\/i>/);
    if (!stateMatch || !cityMatch) continue; // empty trailing cell in an odd-length row

    const state = stateMatch[1];
    const city = fixCity(stripTags(cityMatch[1]));

    const linkMatch = linkCell.match(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;
    const [, href, nameHtml] = linkMatch;
    const name = stripTags(nameHtml);
    if (!name || !href || href === "#") continue; // dead/placeholder link -- not a real listing

    let source_url;
    try {
      source_url = new URL(href, JALR_URL).toString();
    } catch {
      continue;
    }
    if (/\/patient_clinics\//.test(source_url)) continue; // out of scope: Phase II-IV, not Phase-1

    clinics.push({ name, city, state, source_url });
  }
  return clinics;
}

// data/networks.json's `networks` array is a hand-curated, hand-formatted file (per-network
// pull_method/notes prose, compact inline site arrays) -- not something a generic
// JSON.stringify(obj, null, 2) round-trip could reproduce without reformatting every existing
// entry into a huge, content-free diff. So this script never re-serializes that array: it strips
// only its own previously-appended `discovered_networks` block (if a prior run left one) via
// exact string surgery, then appends the freshly-computed one back on, leaving every byte of the
// confirmed `networks` array (and its comments) untouched.
const DISCOVERED_BLOCK_RE =
  /,\s*"_discovered_networks_comment"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*"discovered_networks"\s*:\s*\[[\s\S]*?\]\s*(\}\s*)$/;

function stripExistingDiscoveredBlock(raw) {
  return raw.replace(DISCOVERED_BLOCK_RE, "$1");
}

function appendDiscoveredBlock(raw, discovered) {
  const comment =
    "Found via jalr.org directory crawl (scripts/discover-networks.mjs, story: " +
    "directory-gap-discovery) -- names + locations only, NOT yet called or verified. No pay, " +
    "eligibility, or study data exists for these entries; see docs/DATA-INTEGRITY.md. Promote an " +
    "entry to `networks` above only after actually confirming it (call/visit/live site check).";
  const entriesJson = discovered
    .map((d) => JSON.stringify(d, null, 2).replace(/^/gm, "    ").trimStart())
    .join(",\n    ");
  const block =
    `  "_discovered_networks_comment": ${JSON.stringify(comment)},\n` +
    `  "discovered_networks": [\n    ${entriesJson}\n  ]\n}\n`;
  // raw's tail (after stripping any prior block) is "...networks array...\n  ]\n}\n" -- turn the
  // "]" that closes the networks array into "]," and append the new block, which re-adds its own
  // closing "}".
  return raw.replace(/\]\s*\}\s*$/, "],\n" + block);
}

// Common corporate/clinical-trial noise words -- stripped before comparing names so e.g. "PPD"
// (JALR's label) still overlaps with "PPD / Thermo Fisher" (data/networks.json's fuller name),
// and generic words like "Research" or "Clinical" alone don't cause two unrelated companies that
// happen to share a city (e.g. two different CROs both in Miami, FL) to look like the same entry.
const NAME_STOPWORDS = new Set([
  "the", "inc", "llc", "co", "corp", "corporation", "services", "service", "clinical", "clinic",
  "clinics", "research", "center", "centers", "trials", "trial", "group", "early", "phase", "unit",
  "associates", "and", "of", "solutions", "development", "sciences", "science", "global", "health",
  "institute", "medical", "pharma", "pharmaceutical",
]);

function nameWords(name) {
  return new Set(
    (name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !NAME_STOPWORDS.has(w))
  );
}

function normalizeCity(city) {
  return (city ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function hasOverlap(setA, setB) {
  for (const w of setA) if (setB.has(w)) return true;
  return false;
}

/** Every confirmed/previously-discovered (network, site) pair, as a matcher used to decide
 * whether a freshly-crawled JALR row is a genuine gap or something already in data/networks.json.
 * A row is "already covered" only when BOTH the state matches AND the company name shares a
 * distinctive word with some existing entry AND the city is the same or one contains the other
 * (handles data/networks.json's occasional combined city labels, e.g. "Cypress / Los Angeles")
 * -- matching on city/state alone is not enough, since unrelated companies routinely share a
 * metro (e.g. Miami, FL has both an existing CPMI entry and, per JALR, unrelated Quotient
 * Sciences / Syneos Health sites -- location-only matching would wrongly hide those as "known"). */
function buildKnownEntries(networksJson) {
  const entries = [];
  const collect = (nets) => {
    for (const net of nets ?? []) {
      const words = new Set([...nameWords(net.name), ...nameWords(net.brand)]);
      for (const site of net.sites ?? []) {
        if (site.city && site.state) {
          entries.push({ city: normalizeCity(site.city), state: site.state.toLowerCase(), words });
        }
      }
    }
  };
  // Deliberately only diffs against the CONFIRMED `networks` array, not a prior run's
  // `discovered_networks` -- that section is fully regenerated from the live jalr.org source
  // every run (see main()), so treating it as "known" here would cause each run to silently drop
  // its own previous findings instead of reproducing them.
  collect(networksJson.networks);
  return entries;
}

function isAlreadyKnown(candidate, knownEntries) {
  const candWords = nameWords(candidate.name);
  const candCity = normalizeCity(candidate.city);
  const candState = candidate.state.toLowerCase();
  return knownEntries.some((e) => {
    if (e.state !== candState) return false;
    if (!hasOverlap(candWords, e.words)) return false;
    return e.city === candCity || e.city.includes(candCity) || candCity.includes(e.city);
  });
}

/** Groups newly-found clinic rows by clinic name (case-insensitive) into one discovered-network
 * entry per name, each carrying every new site found for that name. */
function groupIntoDiscoveredNetworks(rows, today) {
  const byName = new Map();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, {
        name: row.name,
        status: "discovered-unverified",
        sites: [],
        source_url: row.source_url,
        discovered: today,
        note:
          "Found via jalr.org directory crawl (story: directory-gap-discovery). Not yet called/verified -- " +
          "no pay, eligibility, or study data exists for this entry. Check the source_url directly before relying on it.",
      });
    }
    const entry = byName.get(key);
    entry.sites.push({ city: row.city, state: row.state, country: "US" });
  }
  return [...byName.values()];
}

/** Confirms a candidate source_url actually resolves before it's written into networks.json --
 * jalr.org's own directory has some dead links to individual clinic pages (confirmed live
 * 2026-08-08: fl_orlando_clinical_research_center.html 404s despite being listed in the table).
 * Per docs/DATA-INTEGRITY.md's "a real, resolving URL a human can click" standard, a discovered
 * entry whose only link is dead doesn't get written -- it's dropped and logged instead. */
async function isReachable(url) {
  try {
    const res = await fetch(url, { method: "GET", headers: { "User-Agent": USER_AGENT } });
    return res.ok;
  } catch {
    return false;
  }
}

async function filterReachable(rows) {
  const results = [];
  for (const row of rows) {
    if (await isReachable(row.source_url)) {
      results.push(row);
    } else {
      warnAnnotation(`Dropping "${row.name}" (${row.city}, ${row.state}) -- source_url does not resolve: ${row.source_url}`);
    }
  }
  return results;
}

async function main() {
  log(`Fetching ${JALR_URL} ...`);
  const res = await fetch(JALR_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`jalr.org fetch failed: HTTP ${res.status}`);
  const html = await res.text();

  const clinics = parseJalrClinics(html);
  log(`Parsed ${clinics.length} clinic listings from jalr.org's Major Phase I Clinics table.`);
  if (clinics.length === 0) {
    warnAnnotation("jalr.org table structure may have changed -- zero clinics parsed, nothing to diff.");
    return;
  }

  const raw = await readFile(NETWORKS_PATH, "utf-8");
  const networksJson = JSON.parse(raw);
  const known = buildKnownEntries(networksJson);

  const candidateRows = clinics.filter((c) => !isAlreadyKnown(c, known));
  log(`${candidateRows.length} of ${clinics.length} clinic sites are not yet in data/networks.json. Checking links resolve...`);
  const newRows = await filterReachable(candidateRows);
  log(`${newRows.length} of ${candidateRows.length} candidates have a resolving source_url.`);

  const today = new Date().toISOString().slice(0, 10);
  const discovered = groupIntoDiscoveredNetworks(newRows, today);
  discovered.sort((a, b) => a.name.localeCompare(b.name));

  for (const d of discovered) {
    log(
      `DISCOVERED  ${d.name} -- ${d.sites.map((s) => `${s.city}, ${s.state}`).join("; ")}`
    );
  }

  if (DRY_RUN) {
    log(`Dry run -- would write ${discovered.length} discovered_networks entries (not writing).`);
    return;
  }

  const newRaw = appendDiscoveredBlock(stripExistingDiscoveredBlock(raw), discovered);
  JSON.parse(newRaw); // fail loudly before writing if the string surgery produced invalid JSON
  await writeFile(NETWORKS_PATH, newRaw, "utf-8");
  log(`Wrote ${discovered.length} discovered_networks entries to ${NETWORKS_PATH}`);
}

main().catch((err) => {
  console.error("[discover-networks] fatal error:", err);
  process.exit(1);
});
