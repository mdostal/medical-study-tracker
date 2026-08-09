#!/usr/bin/env node
// scripts/pull-studies.mjs
//
// Daily refresh puller for medical-study-tracker (story: daily-refresh-scheduled).
//
// Re-pulls confirmed networks' study listings via a headless browser (Playwright) with a
// cache-buster, per docs/DATA-SOURCES.md's documented method ("The golden rule"), and merges
// fresh results into data/studies.seed.json. Run manually with `node scripts/pull-studies.mjs`
// or on a schedule via .github/workflows/daily-study-refresh.yml.
//
// Partial-failure handling (story acceptance criterion 5): each network is pulled independently.
// If a network's pull throws (site down, selector no longer matches i.e. DOM changed) or comes
// back with zero rows, that network's *prior* studies in data/studies.seed.json are retained
// unchanged, the failure is logged with a GitHub Actions `::warning::` annotation (visible on the
// workflow run), and every other network's refresh still proceeds. Nothing is ever silently wiped.
//
// Data-integrity note (docs/DATA-INTEGRITY.md): a study only ships with a real, resolving,
// per-study source_url and verified_by:"playwright-DOM" set from an actual DOM read in this run.
// Only four networks currently have a *documented, concrete* DOM extraction recipe (see
// docs/DATA-SOURCES.md): ICON, Fortrea, Spaulding Clinical, and JBR/CenExel's healthy-volunteer
// listing. Those four are fully automated below (confirmed live 2026-08-08 while building this
// script — see the story's final report for the recon transcript).
//
// story: scrape-detail-page-eligibility (2026-08-09 fix) -- ICON, Fortrea, and JBR/CenExel used to
// stop at the listing page/card (pay, dates, title) and never visited a study's own detail page,
// where the real eligibility criteria (BMI floor/ceiling, special-population gates) actually live
// -- a real correctness bug (a Fortrea GLP-1-medication study requiring BMI 25+ had shipped with
// bmi_min/bmi_max/special_pop all null, silently showing as available to anyone). All three now
// fetch each study's own detail page too, via the shared fetchDetailEligibility()/
// parseEligibilityText() helpers below. Spaulding already read its own detail page; it only needed
// a separate fix for a sex-extraction gap (see pullSpaulding's own comment). Every other confirmed network
// in data/networks.json is phone-only, register-gated, or roster/DB-only per that doc's own
// per-network notes — there is no concrete listing structure documented to scrape. For those, this
// script still visits the portal (with a cache-buster, respecting the "golden rule") to confirm
// it's alive, but deliberately does NOT synthesize study rows from it — inventing a DOM recipe
// that was never verified is exactly the failure mode docs/DATA-INTEGRITY.md was written to
// prevent (see "the incident that made these rules"). Extending PULLERS below with a concrete,
// live-verified recipe per network is the documented next step (docs/DATA-SOURCES.md "coverage
// gaps to fill next").
//
// Usage:
//   node scripts/pull-studies.mjs             # pull everything, merge, write data/studies.seed.json
//   node scripts/pull-studies.mjs --dry-run    # pull + print a diff summary, don't write the file
//   node scripts/pull-studies.mjs --network=ICON   # pull one network only (repeatable)

import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SEED_PATH = path.join(ROOT, "data", "studies.seed.json");

// Standard desktop UA, identified as this project's refresher (polite/transparent, not disguised).
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0 Safari/537.36 medical-study-tracker-refresh/1.0 (+https://github.com/; daily, respectful cadence)";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ONLY_NETWORKS = args
  .filter((a) => a.startsWith("--network="))
  .map((a) => a.slice("--network=".length));

function log(...a) {
  console.log("[pull-studies]", ...a);
}

// GitHub Actions recognizes this exact syntax and renders it as a visible warning annotation on
// the workflow run summary — this is how a partial failure is surfaced rather than silent.
function warnAnnotation(msg) {
  console.log(`::warning::${msg}`);
  log("WARN", msg);
}

// -------------------- shared parsing helpers --------------------

/** "$22,524 to $23,132" | "Up to $32500" | "up to $8,350" -> 32500 (take the ceiling figure —
 * pay is always "up to" per docs/DATA-SOURCES.md, never a fabricated single number). */
function parsePay(text) {
  if (!text) return null;
  const nums = [...text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) =>
    Math.round(parseFloat(m[1].replace(/,/g, "")))
  );
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

/** "Age 18 - 55" | "18-70" | "18+" | "18-65" -> {age_min, age_max} */
function parseAgeRange(text, fallbackMax = 99) {
  if (!text) return { age_min: 18, age_max: fallbackMax };
  const range = text.match(/(\d{1,3})\s*(?:-|to)\s*(\d{1,3})/i);
  if (range) return { age_min: parseInt(range[1], 10), age_max: parseInt(range[2], 10) };
  const plus = text.match(/(\d{1,3})\s*\+/);
  if (plus) return { age_min: parseInt(plus[1], 10), age_max: fallbackMax };
  return { age_min: 18, age_max: fallbackMax };
}

/** "Participation in this study includes 2 screening visits, 1 stay of 10 nights (11 days), and
 * 14 follow-up visits." -> { stays: [10], visits: 14 } (ICON's description-bottom text). */
function parseNightsVisits(text) {
  if (!text) return { stays: null, visits: null };
  const stays = [];
  const stayRe = /(\d+)\s+(?:separate\s+)?stays?\s+of\s+(\d+)\s+nights?/gi;
  let m;
  while ((m = stayRe.exec(text))) {
    const count = parseInt(m[1], 10);
    const nights = parseInt(m[2], 10);
    for (let i = 0; i < count; i++) stays.push(nights);
  }
  const visitsM = text.match(/(\d+)\s+follow-up (?:outpatient )?visits?/i);
  const visits = visitsM ? parseInt(visitsM[1], 10) : null;
  return { stays: stays.length ? stays : null, visits };
}

function cacheBustedUrl(url, hash) {
  const u = new URL(url);
  u.searchParams.set("nocache", Date.now().toString());
  return u.toString() + (hash ?? "");
}

async function newPage(browser) {
  return browser.newPage({ userAgent: USER_AGENT });
}

// -------------------- shared detail-page eligibility extraction --------------------
// story: scrape-detail-page-eligibility -- root-cause fix. Every automated puller below used to
// read ONLY the listing page/card (pay, dates, title) and never visited a study's own detail page,
// where the real eligibility criteria (BMI floor/ceiling, special-population gates like "GLP-1
// medication" or "overweight or have obesity") actually live. Confirmed live 2026-08-09 against
// Fortrea study 781236 (BMI 25+, GLP-1-medication population -- shipped with bmi_min/bmi_max/
// special_pop all null) and, on audit, against several ICON studies (e.g. 3054AC/793: "BMI 27.0 -
// 99.0, Overweight or have obesity", also shipped null) and JBR's one healthy-volunteer study
// ("BMI between 18-32.0kg/m2", also shipped null) -- see this story's final report for the full
// live-verified list. Spaulding already read its own detail page (see pullSpaulding below) and
// only needed the separate sex-extraction fix documented there.
//
// The three parsers below are shared across Fortrea/ICON/JBR's detail-page reads so every network
// reads eligibility text the same way. All are deliberately conservative per
// docs/DATA-INTEGRITY.md's "never fabricate" rule: anything that doesn't clearly match returns
// null (bmi_min/bmi_max/special_pop stay null -- exactly the pre-this-story default -- which
// already surfaces lib/scoring.ts's "confirm BMI on call" flag) rather than guessing.
// special_pop is only ever set from the page's OWN words (it says "overweight" or "GLP-1
// medication" right there) -- never inferred merely from an elevated BMI floor, even when the
// number alone strongly implies it (e.g. ICON study 3705-0020's bare "BMI 27.0 - 99.0" with no
// population sentence anywhere on the page: bmi_min lands as 27, special_pop stays null).
export function parseEligibilityText(text) {
  if (!text) return { bmi_min: null, bmi_max: null, special_pop: null };

  let bmi_min = null;
  let bmi_max = null;

  // "Participants must have a BMI of:\n18-32" (Fortrea) | "BMI 27.0 - 99.0" / "BMI: 27-45" (ICON)
  // | "BMI between 18-32.0kg/m2" (JBR) -- all live-verified 2026-08-09.
  const range = text.match(
    /BMI\s*(?:of|between)?:?\s*\n?\s*(\d{1,3}(?:\.\d+)?)\s*(?:-|to)\s*(\d{1,3}(?:\.\d+)?)/i
  );
  if (range) {
    bmi_min = parseFloat(range[1]);
    bmi_max = parseFloat(range[2]);
  } else {
    // "Participants must have a BMI of:\n25+" (Fortrea 781236) -- a published floor with no
    // stated ceiling; never invent one.
    const plus = text.match(/BMI\s*(?:of|between)?:?\s*\n?\s*(\d{1,3}(?:\.\d+)?)\s*\+/i);
    if (plus) bmi_min = parseFloat(plus[1]);
  }

  // Deliberately narrow phrasing, not a bare "overweight"/"obesity"/"GLP-1" keyword search.
  // Live-verified 2026-08-09: Fortrea study 782366's OWN "Study Details" text reads "...an
  // investigational drug being developed for the treatment of obesity" -- the DRUG's target
  // condition, not a participant requirement (that study recruits plain "Healthy Adults" with no
  // population gate). A bare "obesity" keyword match would have mislabeled it. The two patterns
  // below match ONLY the actual bullet/sentence phrasing every genuine confirmed case actually
  // uses ("Overweight or have obesity" / "Overweight or obese" on ICON; "currently on GLP-1
  // medication" describing who Fortrea is recruiting), not merely mentioning the words somewhere
  // on the page.
  let special_pop = null;
  if (/overweight\s+or\s+(?:have\s+)?obes/i.test(text) || /(?:currently\s+on|taking)\s+GLP-1\s+medication/i.test(text)) {
    special_pop = "overweight_obese";
  }

  return { bmi_min, bmi_max, special_pop };
}

/** "Non Smoker" -> "non" | "Smoking is allowed...", "Smokers & non-smokers allowed", "Smokers
 * allowed, but no more than 10/day" -> "any". Returns null (caller keeps its own listing-derived
 * value) when the detail page doesn't say either way. */
export function parseSmokerFromText(text) {
  if (!text) return null;
  // Checked FIRST: "Smokers & non-smokers allowed" contains the literal substring "non-smoker"
  // too, so checking the plain non-smoker pattern first would misread an explicitly
  // smokers-allowed study as non-smoker-only. Any "allowed" wording wins regardless of order.
  if (/smoking is allowed|smokers?\s*(?:&|and)?\s*non-smokers?\s*allowed|smokers?\s*allowed/i.test(text)) {
    return "any";
  }
  if (/non[\s-]?smoker/i.test(text)) return "non";
  return null;
}

/** "Female Only" / "Women Only" -> "female" | "Male Only" (and not also female) -> "male" |
 * "Male/Female" / "Male and Female" -> "M/F". Returns null when the page doesn't say. Checks
 * female first since "female" contains "male" as a literal substring -- never let that misfire a
 * male-only read off a female-only page. */
export function parseSexFromText(text) {
  if (!text) return null;
  if (/\b(?:female|women)\s*only\b/i.test(text)) return "female";
  if (/\bmale\s*only\b/i.test(text) && !/female/i.test(text)) return "male";
  if (/male\s*\/\s*female|male\s+and\s+female|males?\s+and\s+females?/i.test(text)) return "M/F";
  return null;
}

/** "Age 18 - 68" (ICON) | "ages 18-70" (Fortrea's own top sentence) | "18-65 years old" (JBR) ->
 * {age_min, age_max}. Returns null when the detail page doesn't clearly state a range, so the
 * caller falls back to its own listing-derived age (already reliable for every network below). */
export function parseAgeFromDetailText(text) {
  if (!text) return null;
  const m =
    text.match(/ages?\b[^\d\n]{0,10}(\d{1,3})\s*-\s*(\d{1,3})/i) ??
    text.match(/(\d{1,3})\s*-\s*(\d{1,3})\s*years?\s*old/i);
  if (!m) return null;
  return { age_min: parseInt(m[1], 10), age_max: parseInt(m[2], 10) };
}

/** "Must weigh at least 110 lbs" / "weigh at least 50 Kg (~110 lbs)" -> 110. Same pattern
 * pullSpaulding below already used for its own detail pages -- shared here so JBR's detail page
 * gets the same treatment now that it reads one too. */
export function parseMinWeightLbFromText(text) {
  if (!text) return null;
  const m = text.match(/at least\s*(\d+)\s*lbs?/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Default extraction scope: the whole rendered page. Fine for a network whose detail pages don't
 * repeat OTHER studies' eligibility text anywhere on a single study's own page -- confirmed live
 * 2026-08-09 across multiple Fortrea and the one JBR sample (each page's "BMI" text appeared
 * exactly once, matching that study's own criteria, nowhere near ICON's carousel-contamination
 * problem below). */
async function extractFullBodyText(page) {
  return page.$eval("body", (b) => b.innerText);
}

/** ICON's "Who can participate?" list, scoped to ONLY that list -- NOT the whole page. ICON's
 * detail pages render a same-markup "similar studies" carousel elsewhere on the SAME page that
 * includes OTHER studies' full titles/descriptions. Confirmed live 2026-08-09: study 733's own
 * page literally contains the text "...Investigational Medication in Overweight or Obese
 * Volunteers" because studies 2988/3054AC appear in its "similar studies" carousel -- reading
 * `document.body.innerText` misattributed THEIR special population (and would risk their BMI too)
 * to study 733, which has neither. Falls back to the whole page (matching the pre-scoped
 * behavior) if the expected structure isn't found, rather than throwing. */
async function extractIconEligibilityText(page) {
  const scoped = await page.evaluate(() => {
    const titles = [...document.querySelectorAll(".about-study__questions-item-title")];
    const whoCan = titles.find((el) => /who can participate/i.test(el.textContent ?? ""));
    const list = whoCan?.parentElement?.querySelector(".about-study__questions-item-list");
    return list ? list.innerText : null;
  });
  return scoped ?? (await extractFullBodyText(page));
}

/** Fortrea's own "Study Details" content column, scoped to ONLY that div. No cross-study leakage
 * was observed live across 4 sample Fortrea pages (unlike ICON's carousel above), but scoped
 * anyway as defense in depth against a future template change adding a "similar studies" widget
 * to the same page -- and it has the added benefit of excluding the page's own "BMI Calculator"
 * widget from the search space entirely. Falls back to the whole page if not found. */
async function extractFortreaEligibilityText(page) {
  const scoped = await page.evaluate(() => {
    const h2s = [...document.querySelectorAll("h2")];
    const studyDetails = h2s.find((el) => /study details/i.test(el.textContent ?? ""));
    const container = studyDetails?.closest(".cell.medium-7");
    return container ? container.innerText : null;
  });
  return scoped ?? (await extractFullBodyText(page));
}

/** Visits a study's own detail page (source_url) and extracts real eligibility-criteria fields
 * from its rendered text (scoped per network by `extractText`, defaulting to the whole page) --
 * shared by every puller that doesn't already read its own detail page (Fortrea, ICON, JBR;
 * Spaulding already did before this story). Never throws: a detail page that fails to load (404,
 * timeout, site hiccup) logs a warning and returns an all-null result, which simply leaves the
 * caller's own listing-derived defaults in place -- per docs/DATA-INTEGRITY.md, "can't confirm it"
 * always means null + the existing "confirm BMI on call" flag, never a guess. */
async function fetchDetailEligibility(browser, url, label, extractText = extractFullBodyText) {
  const page = await newPage(browser);
  try {
    await page.goto(cacheBustedUrl(url), { waitUntil: "networkidle", timeout: 45_000 });
    const text = await extractText(page);
    return {
      ...parseEligibilityText(text),
      sex: parseSexFromText(text),
      smoker: parseSmokerFromText(text),
      age: parseAgeFromDetailText(text),
      min_weight_lb: parseMinWeightLbFromText(text),
    };
  } catch (err) {
    warnAnnotation(`${label}: couldn't read detail page for eligibility (${url}) -- ${err.message}`);
    return { bmi_min: null, bmi_max: null, special_pop: null, sex: null, smoker: null, age: null, min_weight_lb: null };
  } finally {
    await page.close();
  }
}

/** De-dupes a network's freshly-pulled studies by `id`, keeping the FIRST occurrence encountered
 * (first-write-wins) and dropping later ones. This is a safety net applied to every puller's
 * output regardless of root-cause fixes upstream, so a future DOM change on any network's site
 * can't silently reintroduce duplicate rows into data/studies.seed.json. Returns the deduped list
 * plus how many rows were dropped, so callers can log/warn when it actually did something. */
function dedupeById(studies) {
  const seen = new Set();
  const deduped = [];
  for (const s of studies) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    deduped.push(s);
  }
  return { deduped, droppedCount: studies.length - deduped.length };
}

// -------------------- ICON (confirmed selector per docs/DATA-SOURCES.md) --------------------
// Method: navigate All-Clinical-Research-Studies?nocache=<ts>#sort=compensation-high, read each
// .studies-card__inner card. Verified live 2026-08-08: 57 raw .studies-card__inner DOM matches
// across SLC / San Antonio / Lenexa, but ONLY 18 are genuinely distinct studies (root cause of
// this story's duplicate-row bug, confirmed live 2026-08-08):
//   1. The page renders each hub's cards a second (or third) time inside Slick carousel widgets
//      (".slick-slider") used for "similar studies" browsing. Slick clones a handful of slides
//      per carousel (marked with a "slick-cloned" ancestor class + aria-hidden="true") to fake an
//      infinite loop — those clones are excluded below since they're not even real content, just
//      DOM padding for the animation.
//   2. Even after dropping clones, the SAME study still legitimately appears as an un-cloned slide
//      in more than one carousel section on the page (e.g. shown once in a hub's own carousel and
//      again in a cross-hub "similar" carousel) — that's real markup, not a scraper artifact, so it
//      can only be handled by deduping on the card's own id, which is done below.
const ICON_HUBS = { slc: "SLC", sanantonio: "SA", lenexa: "LEN" };

async function pullICON(browser) {
  const page = await newPage(browser);
  try {
    const url = cacheBustedUrl("https://iconstudies.com/All-Clinical-Research-Studies/", "#sort=compensation-high");
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForSelector(".studies-card__inner", { timeout: 20_000 });

    const cards = await page.$$eval(".studies-card__inner", (els) =>
      els
        // Drop Slick's inert clone slides (cause #1 above) before reading any content.
        .filter((el) => !el.closest(".slick-cloned"))
        .map((el) => {
          const q = (sel) => el.querySelector(sel)?.textContent?.trim() ?? "";
          const link = el.querySelector(".studies-card__inner-link");
          const applyLink = el.querySelector(".studies-card__controls a");
          const smokerIconHref =
            el.querySelector(".studies-card__smoker use")?.getAttribute("xlink:href") ?? "";
          return {
            href: link?.getAttribute("href") ?? "",
            applyHref: applyLink?.getAttribute("href") ?? "",
            id: q(".studies-card__number-inner"),
            status: q(".studies-card__status-text"),
            title: q(".studies-card__title"),
            price: q(".studies-card__price"),
            location: q(".studies-card__location-text"),
            details: q(".studies-card__details"),
            sex: q(".studies-card__sex-text"),
            age: q(".studies-card__age"),
            smokerIconHref,
          };
        })
    );

    // story: scrape-detail-page-eligibility -- the listing card never carries BMI/special-
    // population info (confirmed live 2026-08-09: several ICON studies, e.g. 793/"3054AC" and
    // 808/"2988", explicitly say "Overweight or have obesity" with a real BMI floor on their OWN
    // detail page while the listing card's title is just "Healthy Volunteers"). Each card's
    // `title` is kept as a low-cost fallback signal, but the detail page is now the authority.
    const studies = [];
    for (const c of cards.filter((c) => c.id && c.href)) {
      const source_url = new URL(c.href, "https://iconstudies.com").toString();
      const apply_url = c.applyHref
        ? new URL(c.applyHref, "https://iconstudies.com").toString()
        : undefined;
      const [city, state] = c.location.split(",").map((s) => s.trim());
      const hubKey = new URL(source_url).pathname.split("/")[1]?.toLowerCase() ?? "";
      const hub = ICON_HUBS[hubKey] ?? hubKey.toUpperCase();
      const { stays, visits } = parseNightsVisits(c.details);
      const listingAge = parseAgeRange(c.age);
      const titleSaysOverweight = /overweight|obese/i.test(c.title);

      const elig = await fetchDetailEligibility(browser, source_url, "ICON", extractIconEligibilityText);

      studies.push({
        id: c.id,
        network: "ICON",
        city: city ?? "",
        state: state ?? "",
        hub,
        pay_gross: parsePay(c.price),
        currency: "USD",
        payout: { type: "unknown", settle_days: null },
        stays,
        visits,
        bmi_min: elig.bmi_min,
        bmi_max: elig.bmi_max,
        age_min: elig.age?.age_min ?? listingAge.age_min,
        age_max: elig.age?.age_max ?? listingAge.age_max,
        sex: elig.sex ?? (/female/i.test(c.sex) && !/male\/female/i.test(c.sex) ? "female" : "M/F"),
        smoker: elig.smoker ?? (/non_smoker/i.test(c.smokerIconHref) ? "non" : "any"),
        special_pop: elig.special_pop ?? (titleSaysOverweight ? "overweight_obese" : null),
        status: c.status ? c.status.toLowerCase() : "enrolling",
        source_url,
        apply_url,
        verified: new Date().toISOString().slice(0, 10),
        verified_by: "playwright-DOM",
        notes: c.title || undefined,
      });
    }

    // Cause #2 above (same study legitimately rendered in >1 carousel section): dedupe by id,
    // first-write-wins. DOM order isn't meaningful here since every duplicate observed live is
    // byte-identical content, so "which copy wins" doesn't change the result.
    const { deduped, droppedCount } = dedupeById(studies);
    if (droppedCount > 0) {
      log(`ICON: dropped ${droppedCount} duplicate-id card(s) (same study rendered in multiple carousel sections)`);
    }
    return deduped;
  } finally {
    await page.close();
  }
}

// -------------------- Fortrea (confirmed: Drupal Views table on /browse-studies) --------------

const FORTREA_HUBS = [
  { match: /dallas/i, state: "TX", hub: "DFW" },
  { match: /daytona/i, state: "FL", hub: "FL" },
  { match: /madison/i, state: "WI", hub: "WI" },
];

async function pullFortrea(browser) {
  const page = await newPage(browser);
  try {
    const url = cacheBustedUrl("https://www.fortreaclinicaltrials.com/en-us/clinical-research/browse-studies");
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForSelector("table.cols-7 tbody tr, table tbody tr", { timeout: 20_000 });

    const rows = await page.$$eval("table tbody tr", (trs) =>
      trs
        .map((tr) => {
          const cell = (idx) => tr.children[idx]?.textContent?.trim() ?? "";
          const link = tr.querySelector("td a");
          return {
            href: link?.getAttribute("href") ?? "",
            title: link?.textContent?.trim() ?? "",
            // The numeric study ID is plain text inside the title <td>, after the <a> — not
            // reliably part of the href (some studies resolve at a short URL alias like "/120"
            // that carries no digits at all; confirmed live 2026-08-08).
            titleCellText: cell(0),
            design: cell(1),
            age: cell(3),
            smoker: cell(4),
            location: cell(5),
            compensation: cell(6),
          };
        })
        .filter((r) => r.href)
    );

    const seenIds = new Map();
    const studies = [];
    for (const r of rows) {
      const source_url = new URL(r.href, "https://www.fortreaclinicaltrials.com").toString();
      const idMatch = r.titleCellText.match(/(\d{5,7})/);
      let id = idMatch ? idMatch[1] : source_url.split("/").pop() ?? r.title;
      const dupeCount = seenIds.get(id) ?? 0;
      seenIds.set(id, dupeCount + 1);
      if (dupeCount > 0) id = `${id}-${dupeCount + 1}`; // disambiguate cohort variants sharing an ID

      const hubInfo = FORTREA_HUBS.find((h) => h.match.test(r.location)) ?? null;
      // Fortrea's DFW/FL/WI units are the ones in data/networks.json — skip any other state that
      // appears on the national table (out of scope for this tool's network list) BEFORE spending
      // a detail-page fetch on it.
      if (!hubInfo) continue;

      const [city] = r.location.split(",").map((s) => s.trim());
      const { stays, visits } = parseNightsVisits(
        r.design.replace(/(\d+)\s+to\s+(\d+)\s+nights/i, (_m, a) => `1 stay of ${a} nights`)
      );
      const listingAge = parseAgeRange(r.age);

      // story: scrape-detail-page-eligibility -- root-cause fix. This used to be the entire
      // extraction: bmi_min/bmi_max/special_pop hardcoded null and sex hardcoded "M/F" with a
      // comment saying the real filter lived on the detail page and was never read. It's now read.
      const elig = await fetchDetailEligibility(browser, source_url, "Fortrea", extractFortreaEligibilityText);

      studies.push({
        id,
        network: "Fortrea",
        city: city ?? "",
        state: hubInfo.state,
        hub: hubInfo.hub,
        pay_gross: parsePay(r.compensation),
        currency: "USD",
        payout: { type: "unknown", settle_days: null },
        stays,
        visits,
        bmi_min: elig.bmi_min,
        bmi_max: elig.bmi_max,
        age_min: elig.age?.age_min ?? listingAge.age_min,
        age_max: elig.age?.age_max ?? listingAge.age_max,
        sex: elig.sex ?? "M/F",
        smoker: elig.smoker ?? (/^y/i.test(r.smoker) ? "any" : "non"),
        special_pop: elig.special_pop,
        status: "enrolling",
        source_url,
        phone: "1-866-429-3700",
        verified: new Date().toISOString().slice(0, 10),
        verified_by: "playwright-DOM",
        notes: r.title || undefined,
      });
    }

    return studies;
  } finally {
    await page.close();
  }
}

// -------------------- Spaulding Clinical (confirmed: /study/<slug>/ detail pages) -------------
// Spaulding already read its own detail page before this story (it never had a listing-only
// shortcut) -- but its REQUIREMENTS block's own sex line ("Healthy Male & Female" | "Healthy
// Female" | "Healthy Male") was never actually parsed; `sex` shipped hardcoded "M/F" for every
// study regardless. Confirmed live 2026-08-09: the "Montgomery" study's own page says "Healthy
// Female" (a real female-only study), yet data/studies.seed.json had it as "M/F" -- the exact same
// silent-eligibility-gap failure mode this story exists to fix, just on a different field. Checks
// "female" before "male" since "female" contains "male" as a literal substring.
function parseSpauldingSex(bodyText) {
  const line = bodyText.match(/Healthy\s+((?:Male|Female)[^\n]*)/i)?.[1] ?? "";
  const hasFemale = /female/i.test(line);
  const hasMale = /\bmale\b/i.test(line.replace(/female/gi, ""));
  if (hasMale && hasFemale) return "M/F";
  if (hasFemale) return "female";
  if (hasMale) return "male";
  return "M/F"; // page didn't say -- keep the pre-existing safe default, never narrow without evidence
}

async function pullSpaulding(browser) {
  const listPage = await newPage(browser);
  let studyLinks;
  try {
    const url = cacheBustedUrl("https://spauldingpays.com/");
    await listPage.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    studyLinks = await listPage.$$eval('a[href*="/study/"]', (as) => [
      ...new Set(as.map((a) => a.getAttribute("href"))),
    ]);
  } finally {
    await listPage.close();
  }

  const studies = [];
  for (const href of studyLinks) {
    const page = await newPage(browser);
    try {
      const url = cacheBustedUrl(new URL(href, "https://www.spauldingpays.com").toString());
      await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
      const bodyText = await page.$eval("body", (b) => b.innerText);
      const slug = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";

      const compMatch = bodyText.match(/Compensation\s*\$?\s*([\d,]+)/i);
      const bmiMatch = bodyText.match(/BMI:?\s*Between\s*(\d+(?:\.\d+)?)\s*and\s*(\d+(?:\.\d+)?)/i);
      const ageMatch = bodyText.match(/Ages?:?\s*(\d{1,3})\s*to\s*(\d{1,3})/i);
      const weightMatch = bodyText.match(/at least\s*(\d+)\s*lbs?/i);
      const nightsMatch = bodyText.match(/(\d+)\s*(?:in-house\s*)?stay[s]?\s*(?:lasting)?\s*(\d+)?\s*days?\/(\d+)\s*nights?/i);

      studies.push({
        id: slug.charAt(0).toUpperCase() + slug.slice(1),
        network: "Spaulding",
        city: "West Bend",
        state: "WI",
        hub: "WI",
        pay_gross: compMatch ? parseInt(compMatch[1].replace(/,/g, ""), 10) : null,
        currency: "USD",
        payout: { type: "unknown", settle_days: null },
        stays: nightsMatch ? [parseInt(nightsMatch[3], 10)] : null,
        visits: 0,
        bmi_min: bmiMatch ? parseFloat(bmiMatch[1]) : null,
        bmi_max: bmiMatch ? parseFloat(bmiMatch[2]) : null,
        age_min: ageMatch ? parseInt(ageMatch[1], 10) : 18,
        age_max: ageMatch ? parseInt(ageMatch[2], 10) : 99,
        sex: parseSpauldingSex(bodyText),
        smoker: "non",
        special_pop: null,
        min_weight_lb: weightMatch ? parseInt(weightMatch[1], 10) : undefined,
        status: "enrolling",
        source_url: url.split("?")[0],
        phone: "1-800-597-4507",
        verified: new Date().toISOString().slice(0, 10),
        verified_by: "playwright-DOM",
      });
    } catch (err) {
      warnAnnotation(`Spaulding: failed to read study detail page ${href} (${err.message})`);
    } finally {
      await page.close();
    }
  }
  if (studies.length === 0) throw new Error("no /study/ links found on spauldingpays.com homepage");
  return studies;
}

// -------------------- JBR / Jean Brown Research (CenExel) --------------------------------------
// cenexelresearch.com/jbr/all-studies mixes patient trials (bunion, migraine, diabetes...) with
// the healthy-volunteer cohort this app tracks. Keep only rows whose title says "Healthy" — the
// patient roster is out of scope for a Phase-1/healthy-volunteer tracker (see docs/DATA-SOURCES.md).

async function pullJBR(browser) {
  const page = await newPage(browser);
  try {
    const url = cacheBustedUrl("https://cenexelresearch.com/jbr/all-studies");
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForSelector(".study-row", { timeout: 20_000 });

    const rows = await page.$$eval(".study-row", (els) =>
      els.map((el) => {
        const anchor = el.closest("a");
        const titleEl = el.querySelector(".column-study-title p");
        const statusEl = el.querySelector(".study-status");
        return {
          href: anchor?.getAttribute("href") ?? "",
          title: titleEl?.firstChild?.textContent?.trim() ?? titleEl?.textContent?.trim() ?? "",
          status: statusEl?.textContent?.trim() ?? "",
          gender: el.querySelector(".column-study-gender p")?.textContent?.trim() ?? "",
          age: el.querySelector(".column-study-age p")?.textContent?.trim() ?? "",
          compensation: el.querySelector(".column-study-compensation p")?.textContent?.trim() ?? "",
        };
      })
    );

    const healthy = rows.filter((r) => /healthy/i.test(r.title) && r.href);
    // story: scrape-detail-page-eligibility -- confirmed live 2026-08-09: JBR's own healthy-
    // volunteer detail page says "Must have a BMI between 18-32.0kg/m2 / Must weigh at least 110
    // lbs" in its "STUDY DETAILS" blurb, none of which the listing-only extraction below ever read
    // (bmi_min/bmi_max shipped null).
    const studies = [];
    for (const r of healthy) {
      const listingAge = parseAgeRange(r.age);
      const elig = await fetchDetailEligibility(browser, r.href, "JBR/CenExel");
      studies.push({
        id: `JBR-${r.title.replace(/\s+/g, "")}`,
        network: "JBR/CenExel",
        city: "Salt Lake City",
        state: "UT",
        hub: "SLC",
        pay_gross: parsePay(r.compensation),
        currency: "USD",
        payout: { type: "unknown", settle_days: null, note: "'for time and travel'; long visit tail" },
        stays: null,
        visits: null,
        bmi_min: elig.bmi_min,
        bmi_max: elig.bmi_max,
        age_min: elig.age?.age_min ?? listingAge.age_min,
        age_max: elig.age?.age_max ?? listingAge.age_max,
        sex: elig.sex ?? "M/F",
        smoker: elig.smoker ?? "any",
        special_pop: elig.special_pop,
        min_weight_lb: elig.min_weight_lb ?? undefined,
        status: r.status ? r.status.toLowerCase() : "enrolling",
        source_url: r.href,
        phone: "801-261-2000",
        verified: new Date().toISOString().slice(0, 10),
        verified_by: "playwright-DOM",
        notes: r.title,
      });
    }
    if (studies.length === 0) {
      throw new Error("no 'Healthy' study rows found on cenexelresearch.com/jbr/all-studies");
    }
    return studies;
  } finally {
    await page.close();
  }
}

// -------------------- Automated pullers registry --------------------
// Keyed by the exact `network` string used in data/studies.seed.json rows.

const PULLERS = {
  ICON: pullICON,
  Fortrea: pullFortrea,
  Spaulding: pullSpaulding,
  "JBR/CenExel": pullJBR,
};

// -------------------- Portal-reachability-only checks --------------------
// No confirmed DOM extraction recipe documented for these yet (phone-only / register-gated /
// roster-DB per docs/DATA-SOURCES.md). We still visit with a cache-buster so a hard outage is
// visible, but we never synthesize studies from an unconfirmed selector. Prior data is retained.

const PORTAL_ONLY_CHECK = {
  "PPD/Thermo": "https://trialmed.com/find-a-study/",
  Celerion: "https://helpresearch.com/",
  Altasciences: "https://participantskc.altasciences.com/available-studies",
  Nucleus: "https://nucleusnetwork.com/participants/find-a-trial",
  Frontage: "https://www.frontagelab.com/enroll-in-a-study/",
  "BioPharma Services": "https://biopharmaservices.com/volunteers/",
  Worldwide: "https://www.worldwide.com/participate-in-a-study/",
};

async function checkPortalReachable(browser, url) {
  const page = await newPage(browser);
  try {
    await page.goto(cacheBustedUrl(url), { waitUntil: "domcontentloaded", timeout: 30_000 });
  } finally {
    await page.close();
  }
}

// -------------------- merge + write --------------------

function groupByNetwork(studies) {
  const map = new Map();
  for (const s of studies) {
    if (!map.has(s.network)) map.set(s.network, []);
    map.get(s.network).push(s);
  }
  return map;
}

// Serialize to match the existing file's style: one compact JSON object per line.
function serializeSeed(seed) {
  const lines = seed.studies.map((s) => "    " + JSON.stringify(s));
  return (
    "{\n" +
    `  "_comment": ${JSON.stringify(seed._comment)},\n` +
    '  "studies": [\n' +
    lines.join(",\n") +
    "\n  ]\n}\n"
  );
}

async function main() {
  const raw = await readFile(SEED_PATH, "utf-8");
  const seed = JSON.parse(raw);
  const priorByNetwork = groupByNetwork(seed.studies);

  const browser = await chromium.launch();
  const summary = { refreshed: {}, retained: {}, checked: {}, failed: {} };
  const finalStudies = [];

  const pullerEntries = Object.entries(PULLERS).filter(
    ([net]) => ONLY_NETWORKS.length === 0 || ONLY_NETWORKS.includes(net)
  );

  for (const [network, puller] of pullerEntries) {
    try {
      const fresh = await puller(browser);
      if (!fresh || fresh.length === 0) {
        throw new Error("pull returned zero studies (selector may not match current DOM)");
      }
      // Safety net regardless of each puller's own dedup logic: no network's output should ever
      // reach the written file with a repeated id (see dedupeById's doc comment above).
      const { deduped, droppedCount } = dedupeById(fresh);
      if (droppedCount > 0) {
        warnAnnotation(
          `${network}: puller returned ${fresh.length} rows with ${droppedCount} duplicate id(s) — deduped to ${deduped.length} before writing.`
        );
      }
      finalStudies.push(...deduped);
      summary.refreshed[network] = deduped.length;
      log(`OK    ${network}: refreshed ${deduped.length} studies`);
    } catch (err) {
      const prior = priorByNetwork.get(network) ?? [];
      finalStudies.push(...prior);
      summary.failed[network] = err.message;
      summary.retained[network] = prior.length;
      warnAnnotation(
        `${network} pull failed (${err.message}) — retained ${prior.length} prior studies unchanged.`
      );
    }
  }

  // Networks not in PULLERS at all (not attempted this run, e.g. filtered via --network=): keep as-is.
  for (const [network, studies] of priorByNetwork) {
    if (pullerEntries.some(([n]) => n === network)) continue;
    finalStudies.push(...studies);
  }

  if (ONLY_NETWORKS.length === 0) {
    for (const [network, url] of Object.entries(PORTAL_ONLY_CHECK)) {
      try {
        await checkPortalReachable(browser, url);
        summary.checked[network] = "portal reachable — no automated listing extraction yet, manual/prior data retained";
        log(`CHECK ${network}: portal reachable, no extraction recipe yet — prior data retained`);
      } catch (err) {
        summary.failed[network] = `portal unreachable: ${err.message}`;
        warnAnnotation(`${network} portal unreachable (${err.message}) — retained prior data unchanged.`);
      }
    }
  }

  await browser.close();

  finalStudies.sort((a, b) => (b.pay_gross ?? -1) - (a.pay_gross ?? -1));
  const newSeed = { ...seed, studies: finalStudies };

  log("Summary:", JSON.stringify(summary, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    const md =
      `### Daily study refresh\n\n` +
      `| Network | Result |\n|---|---|\n` +
      Object.entries(summary.refreshed).map(([n, c]) => `| ${n} | refreshed — ${c} studies |`).join("\n") +
      (Object.keys(summary.refreshed).length ? "\n" : "") +
      Object.entries(summary.checked).map(([n]) => `| ${n} | portal checked, not automated — retained |`).join("\n") +
      (Object.keys(summary.checked).length ? "\n" : "") +
      Object.entries(summary.failed).map(([n, e]) => `| ${n} | **FAILED** — ${e} — prior data retained |`).join("\n") +
      "\n";
    await appendFile(process.env.GITHUB_STEP_SUMMARY, md);
  }

  if (DRY_RUN) {
    log(`Dry run — would write ${finalStudies.length} studies to ${SEED_PATH} (not writing).`);
    return;
  }

  await writeFile(SEED_PATH, serializeSeed(newSeed), "utf-8");
  log(`Wrote ${finalStudies.length} studies to ${SEED_PATH}`);
}

// Only run main() when this file is executed directly (`node scripts/pull-studies.mjs`) -- not
// when a test file imports this module's exported pure parsers above, same "importable without
// side effects" shape scripts/aggregate-corrections.mjs already uses.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[pull-studies] fatal error:", err);
    process.exit(1);
  });
}
