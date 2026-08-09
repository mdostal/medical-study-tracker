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

// story: fix-study-deep-links -- several of this story's new listing pages (Altasciences KC in
// particular, confirmed live 2026-08-09) render their study links via a client-side AJAX view
// that inserts anchors WITHOUT a real href first and rewrites it a moment later, so
// `waitForSelector('a[href*="..."]')` can resolve on that transient pre-rewrite state and hand
// back zero real matches even though the selector "found" something. A plain "networkidle" goto
// isn't the fix either -- it hangs indefinitely on some of these same pages (a persistent
// background request, likely a chat widget or embedded map, never lets the network go idle; also
// confirmed live 2026-08-09 against this same KC page). This bounded, non-throwing settle — used
// after `domcontentloaded` + a selector wait on every new listing page below — gives the page a
// little more time to finish any such rewrite without ever blocking a whole run on it.
async function settleAfterSelector(page, timeout = 8_000) {
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
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

// story: fix-study-deep-links -- the real bug behind study 783120 resolving to
// "https://www.fortreaclinicaltrials.com/120". Live-verified 2026-08-09 (see this story's final
// report for the full transcript): that URL is NOT a scraper defect and it does NOT currently
// 404 or bounce to the homepage -- fetching it directly (curl and Playwright, both with a fresh
// session) returns 200 with study 783120's own title, its own $9,929 compensation, and its own
// "18 nights" detail all present in the page body. Fortrea's own DOM literally serves
// `<a href="/120">` for this one row (confirmed by reading the live table's outerHTML) -- every
// other Fortrea study observed follows /en-us/clinical-research/<id>[-slug]; this is the one
// exception, apparently a node that never got Fortrea's normal descriptive URL alias.
//
// The actual bug this fixes: `new URL(href, base)` was trusted blindly for EVERY row, with no
// check that the resolved URL is even shaped like a study page. That's the exact failure mode
// docs/DATA-INTEGRITY.md's "incident" describes (a link that looks like a per-study link but
// isn't) -- a future markup change could just as easily emit href="/" (the bare homepage) or a
// link back to /browse-studies itself, and this puller would have shipped it unquestioned. Now:
// a canonical-shaped href (/en-us/clinical-research/<id>[-slug]) is trusted as before; anything
// else is first checked against the two shapes that would actually reproduce "landed on the
// homepage" (the bare domain root, or the listing page itself) and dropped if so; anything still
// left over (783120's shape) gets a real content cross-check -- per Rule 3 ("cross-check pay
// against the page text"), not just "a URL string exists" -- before being trusted. A row that
// fails that check is dropped (becomes a phone-only gap for a human to check) rather than
// shipping a link nobody has verified.
const FORTREA_CANONICAL_STUDY_URL_RE =
  /^https:\/\/www\.fortreaclinicaltrials\.com\/en-us\/clinical-research\/[^/]+\/?$/i;

export function looksLikeFortreaListingOrHome(url) {
  return (
    /^https:\/\/www\.fortreaclinicaltrials\.com\/?$/i.test(url) ||
    /\/browse-studies\/?$/i.test(url)
  );
}

/** Cross-verifies an anomalously-shaped Fortrea href (doesn't match the normal
 * /en-us/clinical-research/<id>[-slug] pattern -- e.g. study 783120's bare "/120") actually opens
 * THAT study's own detail page before pull-studies.mjs trusts it as source_url. Confirms both the
 * study's own numeric id AND at least one of the listing row's own compensation figures appear in
 * the resolved page's own rendered text. Never throws: a page that fails to load, or one whose
 * content doesn't verify, returns false -- the caller drops the row rather than shipping an
 * unverified link. */
async function verifyFortreaAnomalousUrl(browser, url, id, compensationText) {
  const page = await newPage(browser);
  try {
    await page.goto(cacheBustedUrl(url), { waitUntil: "networkidle", timeout: 45_000 });
    const text = await page.$eval("body", (b) => b.innerText);
    const hasId = text.includes(id);
    const payFigures = [...(compensationText ?? "").matchAll(/\$\s?([\d,]+)/g)].map((m) => m[1]);
    const hasPay = payFigures.length === 0 || payFigures.some((p) => text.includes(p));
    return hasId && hasPay;
  } catch (err) {
    warnAnnotation(`Fortrea: couldn't verify anomalous-shape URL ${url} -- ${err.message}`);
    return false;
  } finally {
    await page.close();
  }
}

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

      // story: fix-study-deep-links -- never blindly trust a non-canonical-shaped href (see
      // FORTREA_CANONICAL_STUDY_URL_RE's comment above). A homepage/listing-shaped resolution is
      // dropped outright; anything else non-canonical (783120's bare "/120" today) gets a real
      // content cross-check before being trusted as source_url.
      if (!FORTREA_CANONICAL_STUDY_URL_RE.test(source_url)) {
        if (looksLikeFortreaListingOrHome(source_url)) {
          warnAnnotation(
            `Fortrea: study "${id}" href resolved to the listing/homepage (${source_url}) -- dropping rather than shipping a disguised link.`
          );
          continue;
        }
        const verified = await verifyFortreaAnomalousUrl(browser, source_url, id, r.compensation);
        if (!verified) {
          warnAnnotation(
            `Fortrea: study "${id}" href (${source_url}) doesn't match the normal per-study URL shape and its own page content didn't verify (id/pay not found on it) -- dropping rather than shipping an unverified link.`
          );
          continue;
        }
        log(
          `Fortrea: study "${id}" uses a non-standard URL shape (${source_url}) but its own detail page content verified (id "${id}" + a listing compensation figure both found on it) -- keeping it.`
        );
      }

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

// -------------------- Altasciences (confirmed: all 3 sites publish real per-study pages) --------
// story: fix-study-deep-links. All 3 Altasciences sites (participants{kc,la,mtl}.altasciences.com)
// were previously PORTAL_ONLY_CHECK-only -- source_url shipped as the generic listing page
// (/available-studies, /current-studies, /etudes-disponibles). Live-verified 2026-08-09: EVERY one
// of them actually publishes a real, distinct, resolving per-study detail page with its own URL:
//   - KC and MTL run the same underlying engine (a Drupal "Ajax Study Detail" module) at
//     /etudes/<internal-numeric-id> (MTL's English mirror is at /en/etudes/<id> -- used here so the
//     shared English-language text parsers below apply to both sites unmodified).
//   - LA runs a different template, at /current-studies/<code>-en-1.
// Each detail page's own rendered text plainly states pay, BMI, age, sex, smoking policy, and a
// prose "Available for: N screening visit(s), an M-night stay, and P outpatient visits"-style
// summary (KC/LA) or an explicit "Clinic stay"/"Return visits" date block (MTL) -- confirmed
// against the study numbers already in data/studies.seed.json (e.g. KC's #89427-89430, LA's
// N-40200/N-34300/N-39620/N-38800, MTL's 4727-01 A1b/A2a) with pay figures matching exactly, so
// this is a real recipe, not a guess. One correction this pull surfaces: MTL study "4727-01 A1b"'s
// own page states its actual stay length via dated Clinic-stay/Return-visit lines the same way as
// every other MTL study -- computed here rather than hand-entered.
//
// Filtering: all 3 listings mix genuinely-healthy/overweight-obese studies (this tool's scope, see
// docs/DATA-SOURCES.md) with disease-diagnosis-gated patient studies (e.g. LA's "Diagnosed with
// Type 2 diabetes" row) -- out of scope the same way JBR's own puller above filters to "Healthy"
// titles only. ALTASCIENCES_EXCLUDE_RE below drops any row whose own qualifications explicitly
// require a pre-existing diagnosed condition; a plain "overweight or obese but otherwise healthy"
// or "currently on GLP-1/Semaglutide/etc. medication" row is kept (matches the overweight_obese
// population this tool already tracks for Fortrea/ICON).
//
// LA's listing also mixes in pages that are NOT a specific study at all -- confirmed live
// 2026-08-09: "Friends Referral Campaign #J-5000"/"#C-5010" (a referral-bonus page, no study of
// its own), "Help us with future medical development #J-2010" (a future-consideration signup
// funnel), and "Generally Healthy Volunteers #N-3030" (a vague $1,000-$10,000 "join our pool"
// page, not a dated study with its own criteria). Every one of these, and no genuine dated study
// sampled, contains the site's own tell "eligibility criteria vary between studies" -- shipping
// one of these as if it were a specific study (a wide non-specific pay range presented as a real
// figure) would be exactly the failure mode docs/DATA-INTEGRITY.md exists to prevent, so they're
// excluded here alongside the diagnosed-condition rows.
const ALTASCIENCES_EXCLUDE_RE =
  /diagnosed with|diagnosis of|type\s*2\s*diabetes|eligibility criteria vary between studies|referral campaign|future medical development/i;

const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const MONTH_INDEX = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Nights between two "DD Mon" dates (Altasciences MTL's own "Clinic stay" line, e.g. "31 Aug
 * (17:30) to 5 Sep (09:00)"). Assumes the current year, rolling to next year if the end month
 * comes before the start month (a stay spanning a New Year). Returns null (never guesses) if
 * either month name isn't recognized or the computed length is outside a sane 0-120 night bound. */
export function nightsBetweenMonthDay(d1, mon1, d2, mon2) {
  const mi1 = MONTH_INDEX[mon1.slice(0, 3).toLowerCase()];
  const mi2 = MONTH_INDEX[mon2.slice(0, 3).toLowerCase()];
  if (mi1 == null || mi2 == null) return null;
  const year = new Date().getUTCFullYear();
  const start = Date.UTC(year, mi1, parseInt(d1, 10));
  let end = Date.UTC(year, mi2, parseInt(d2, 10));
  if (end < start) end = Date.UTC(year + 1, mi2, parseInt(d2, 10));
  const nights = Math.round((end - start) / 86_400_000);
  return nights > 0 && nights <= 120 ? nights : null;
}

/** Altasciences' own two stay/visit phrasings, both confirmed live 2026-08-09:
 *  - KC/LA prose: "...an 8-night stay..." / "...two 8-night stays..." / "9 day/8-night stay" plus
 *    "N outpatient visit(s)" elsewhere in the same paragraph.
 *  - MTL: no such prose -- an explicit "Clinic stay\n<D Mon> (..) to <D Mon> (..)" date range plus
 *    a "Return visits\n<dated lines>" list (each line counted as one visit).
 * Never fabricates a count neither phrasing states -- returns null fields when nothing matches. */
export function parseAltasciencesStaysVisits(text) {
  if (!text) return { stays: null, visits: null };

  const stays = [];
  const stayRe = /\b(a|an|one|two|three|four|five|six)?\s*(\d+)-night stays?/gi;
  let m;
  while ((m = stayRe.exec(text))) {
    const count = NUMBER_WORDS[(m[1] ?? "").toLowerCase()] ?? 1;
    const nights = parseInt(m[2], 10);
    for (let i = 0; i < count; i++) stays.push(nights);
  }
  if (stays.length > 0) {
    const outpatientM = text.match(/(\d+)\s+outpatient visits?/i);
    return { stays, visits: outpatientM ? parseInt(outpatientM[1], 10) : null };
  }

  const rangeM = text.match(
    /Clinic stay\s*\n+\s*(\d{1,2})\s+([A-Za-z]{3,})[^\n]*?(?:to|au)\s*(\d{1,2})\s+([A-Za-z]{3,})/i
  );
  const mtlNights = rangeM ? nightsBetweenMonthDay(rangeM[1], rangeM[2], rangeM[3], rangeM[4]) : null;
  const returnSection = text.match(
    /Return visits\s*\n([\s\S]*?)(?:Participants must be available|Medication type|\nNotes\n|$)/i
  );
  const visitDates = returnSection
    ? returnSection[1].match(/\d{1,2}\s+[A-Za-z]{3,}\s*\(\d{2}:\d{2}\)/g)
    : null;
  return { stays: mtlNights ? [mtlNights] : null, visits: visitDates ? visitDates.length : null };
}

/** LA's own BMI phrasing ("Body Mass Index (BMI) between 27.0 and 39.9 kg/m²") uses "and" rather
 * than the "-"/"to" every other network's BMI line uses, so the shared parseEligibilityText above
 * doesn't match it -- a dedicated pattern for LA's own wording, same never-guess-if-absent shape. */
function parseAltasciencesLABmi(text) {
  const m = text?.match(/Body Mass Index\s*\(BMI\)\s*between\s*(\d+(?:\.\d+)?)\s*and\s*(\d+(?:\.\d+)?)/i);
  return m ? { bmi_min: parseFloat(m[1]), bmi_max: parseFloat(m[2]) } : { bmi_min: null, bmi_max: null };
}

/** LA's own weight-floor phrasing ("Have a body weight of over 132 lbs.") uses "over", not the
 * "at least" the shared parseMinWeightLbFromText above expects. */
function parseAltasciencesLAWeight(text) {
  const m = text?.match(/body weight of over\s*(\d+)\s*lbs?/i);
  return m ? parseInt(m[1], 10) : null;
}

/** KC/MTL's own smoking phrasing ("Smoking habit: Non / Ex-smoker only" / "Smoker or non-smoker")
 * doesn't match the shared parseSmokerFromText above (which expects "non-smoker" as one token). */
function parseAltasciencesSmoker(text) {
  if (!text) return null;
  if (/smoker or non-smoker/i.test(text)) return "any";
  if (/non\s*\/\s*ex-smoker/i.test(text)) return "non";
  return null;
}

/** Derives this tool's existing id-code convention for KC/MTL from the detail page's own
 * "h2.title.restriction" heading text (confirmed live 2026-08-09 against both sites' real
 * headings). KC's heading is a descriptive title with TWO parenthesized group codes ("Healthy
 * Participants (S51) (B2a)" -> "S51-B2a", matching data/studies.seed.json's pre-existing "S51-B2a
 * #89427" convention). MTL's heading is a leading code plus ONE group ("4727-01 (A1b)" ->
 * "4727-01 A1b", matching this tool's pre-existing "4727-01 A1b" rows). Falls back to the raw
 * heading unchanged if neither shape is recognized, rather than guessing. */
export function deriveAltasciencesCode(heading) {
  const groups = [...heading.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
  if (groups.length >= 2) return groups.join("-"); // KC-style
  if (groups.length === 1) {
    const prefix = heading.split("(")[0].trim();
    return prefix ? `${prefix} ${groups[0]}` : groups[0]; // MTL-style
  }
  return heading.trim();
}

/** KC and MTL (English mirror) share the same "Ajax Study Detail" module -- one scraper for both,
 * parameterized by site. Confirmed live 2026-08-09. */
async function scrapeAltasciencesAjaxSite(browser, { label, listUrl, base, hub, city, state, country, phone }) {
  const listPage = await newPage(browser);
  let cards;
  try {
    // "networkidle" confirmed live 2026-08-09 to hang indefinitely on this listing page (a
    // persistent background request — likely the embedded Google Map or a chat widget — never
    // lets the network go idle); "domcontentloaded" + an explicit selector wait is what ICON's
    // puller above already falls back on for the same reason and is reliable here too.
    await listPage.goto(cacheBustedUrl(listUrl), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await listPage.waitForSelector('a[href*="etudes/"]', { state: "attached", timeout: 20_000 });
    await settleAfterSelector(listPage);
    cards = await listPage.$$eval('a[href*="etudes/"]', (as) =>
      as
        .map((a) => ({ href: a.getAttribute("href") ?? "", text: a.textContent?.trim() ?? "" }))
        // KC's own href is relative WITHOUT a leading slash ("etudes/89427"); MTL's has one
        // ("/etudes/89252") — confirmed live 2026-08-09, both sites' own markup, not a scraper
        // quirk. Matched without requiring the leading slash so both resolve correctly below.
        .filter((c) => /etudes\/\d+/.test(c.href))
    );
  } finally {
    await listPage.close();
  }

  const studies = [];
  for (const card of cards) {
    const detailUrl = new URL(card.href, base).toString();
    const page = await newPage(browser);
    try {
      await page.goto(cacheBustedUrl(detailUrl), { waitUntil: "networkidle", timeout: 45_000 });
      const text = await page.$eval("body", (b) => b.innerText);

      if (ALTASCIENCES_EXCLUDE_RE.test(text)) continue; // diagnosed-condition-gated patient study — out of scope

      // Study code lives in a dedicated "h2.title.restriction" element (confirmed live 2026-08-09,
      // both sites) — read via its own textContent (NOT body innerText, which reflects CSS
      // text-transform: uppercase applied to this element and would report "A1B" for a heading
      // that's actually cased "A1b" in the real DOM). KC's own heading is a descriptive title with
      // TWO group codes ("Healthy Participants (S51) (B2a)"); MTL's is a leading code plus ONE
      // group ("4727-01 (A1b)") — deriveAltasciencesCode below handles both shapes. The internal
      // numeric id (from the URL) is appended to match this tool's existing id convention for this
      // site (e.g. "S51-B2a #89427", already in data/studies.seed.json before this puller existed).
      const heading = (await page.$eval("h2.title.restriction", (el) => el.textContent?.trim() ?? "").catch(() => "")) || card.text;
      const code = deriveAltasciencesCode(heading);
      const numericId = detailUrl.match(/etudes\/(\d+)/)?.[1] ?? "";
      const id = numericId ? `${code} #${numericId}` : code;

      const eligText = parseEligibilityText(text); // shared BMI/special_pop parser (matches "BMI :\nX - Y")
      const age = parseAgeFromDetailText(text);
      const { stays, visits } = parseAltasciencesStaysVisits(text);

      studies.push({
        id,
        network: "Altasciences",
        city,
        state,
        country,
        hub,
        pay_gross: parsePay(text),
        currency: country === "Canada" ? "CAD" : "USD",
        payout: { type: "unknown", settle_days: null, note: "ClinCard" },
        stays,
        visits,
        bmi_min: eligText.bmi_min,
        bmi_max: eligText.bmi_max,
        age_min: age?.age_min ?? 18,
        age_max: age?.age_max ?? 99,
        sex: parseSexFromText(text) ?? "M/F",
        smoker: parseAltasciencesSmoker(text) ?? "non",
        special_pop: eligText.special_pop,
        eligible: true,
        source_url: detailUrl,
        phone,
        verified: new Date().toISOString().slice(0, 10),
        verified_by: "playwright-DOM",
        notes: heading || undefined,
      });
    } catch (err) {
      warnAnnotation(`${label}: failed to read study detail page ${detailUrl} (${err.message})`);
    } finally {
      await page.close();
    }
  }
  return studies;
}

// LA's own template differs from KC/MTL's Ajax module (confirmed live 2026-08-09): studies live at
// /current-studies/<code>-en-1, with a plain "Qualifications" paragraph rather than a labeled
// BMI/Age/Sex field block. It also paginates (?page=1, ?page=2, ...) -- walked here up to a safety
// cap so a live site with an unexpectedly long list can't turn one refresh into an unbounded crawl.
const ALTASCIENCES_LA_MAX_PAGES = 6;

async function pullAltasciencesLA(browser) {
  const hrefs = new Set();
  for (let p = 0; p < ALTASCIENCES_LA_MAX_PAGES; p++) {
    const page = await newPage(browser);
    try {
      const url = cacheBustedUrl(`https://participantsla.altasciences.com/current-studies?page=${p}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForSelector('a[href*="/current-studies/"]', { state: "attached", timeout: 20_000 });
      await settleAfterSelector(page);
      const pageHrefs = await page.$$eval('a[href*="/current-studies/"]', (as) =>
        as.map((a) => a.getAttribute("href") ?? "").filter((h) => /\/current-studies\/[a-z0-9-]+-en-1/i.test(h))
      );
      if (pageHrefs.length === 0) break; // ran off the end of pagination
      const before = hrefs.size;
      for (const h of pageHrefs) hrefs.add(h);
      if (hrefs.size === before) break; // this page repeated the last one — stop rather than loop
    } catch (err) {
      warnAnnotation(`Altasciences LA: failed to read current-studies page ${p} (${err.message})`);
      break;
    } finally {
      await page.close();
    }
  }

  const studies = [];
  for (const href of hrefs) {
    const detailUrl = new URL(href, "https://participantsla.altasciences.com").toString();
    const page = await newPage(browser);
    try {
      await page.goto(cacheBustedUrl(detailUrl), { waitUntil: "networkidle", timeout: 45_000 });
      const text = await page.$eval("body", (b) => b.innerText);

      if (ALTASCIENCES_EXCLUDE_RE.test(text)) continue; // diagnosed-condition-gated — out of scope

      // Study code is in the URL slug itself (e.g. ".../n-40200-en-1") — the exact code this tool
      // already uses as `id` for this site's existing rows ("N-40200"). NOTE: the slug body itself
      // contains hyphens ("n-40200"), so the capture group must allow "-" too and the "-en-1"
      // suffix is stripped separately -- a character class of just [a-z0-9] (no hyphen) here would
      // fail to match anything past the study code's own first hyphen.
      const slugM = detailUrl.match(/\/current-studies\/([a-z0-9-]+)$/i);
      const id = slugM ? slugM[1].replace(/-en-1$/i, "").toUpperCase() : (href.split("/").pop() ?? href);

      const eligText = parseEligibilityText(text);
      const laBmi = parseAltasciencesLABmi(text);
      const age = parseAgeFromDetailText(text);
      const { stays, visits } = parseAltasciencesStaysVisits(text);
      const minWeight = parseAltasciencesLAWeight(text);

      studies.push({
        id,
        network: "Altasciences",
        city: "Cypress",
        state: "CA",
        hub: "SOCAL",
        pay_gross: parsePay(text),
        currency: "USD",
        payout: { type: "unknown", settle_days: null, note: "ClinCard" },
        stays,
        visits,
        bmi_min: eligText.bmi_min ?? laBmi.bmi_min,
        bmi_max: eligText.bmi_max ?? laBmi.bmi_max,
        age_min: age?.age_min ?? 18,
        age_max: age?.age_max ?? 99,
        sex: parseSexFromText(text) ?? "M/F",
        smoker: parseAltasciencesSmoker(text) ?? "non",
        special_pop: eligText.special_pop,
        min_weight_lb: minWeight ?? undefined,
        eligible: true,
        source_url: detailUrl,
        phone: "1-866-461-2526",
        verified: new Date().toISOString().slice(0, 10),
        verified_by: "playwright-DOM",
      });
    } catch (err) {
      warnAnnotation(`Altasciences LA: failed to read study detail page ${detailUrl} (${err.message})`);
    } finally {
      await page.close();
    }
  }
  return studies;
}

/** All 3 Altasciences sites share the `network: "Altasciences"` value in data/studies.seed.json
 * (see e.g. the existing KC/LA/MTL rows before this story), so PULLERS below needs exactly one
 * entry for it -- this combines all 3 site scrapers into one puller, same shape as every other
 * PULLERS entry (one async function, returns a flat studies array). Each site's own scraper is
 * independent: one site's DOM changing/failing doesn't take the other two down with it (each is
 * wrapped so a thrown error there is logged and treated as "this site found nothing" rather than
 * aborting the whole combined pull). */
async function pullAltasciences(browser) {
  const sites = [
    () =>
      scrapeAltasciencesAjaxSite(browser, {
        label: "Altasciences KC",
        listUrl: "https://participantskc.altasciences.com/available-studies",
        base: "https://participantskc.altasciences.com",
        hub: "LEN",
        city: "Overland Park",
        state: "KS",
        country: undefined,
        phone: "913-213-2970",
      }),
    () => pullAltasciencesLA(browser),
    () =>
      scrapeAltasciencesAjaxSite(browser, {
        label: "Altasciences MTL",
        listUrl: "https://participantsmtl.altasciences.com/en/available-studies",
        base: "https://participantsmtl.altasciences.com",
        hub: "MTL",
        city: "Montreal",
        state: "QC",
        country: "Canada",
        phone: "514-381-2546",
      }),
  ];

  const results = [];
  for (const run of sites) {
    try {
      const studies = await run();
      results.push(...studies);
    } catch (err) {
      warnAnnotation(`Altasciences: one site's scraper failed entirely (${err.message}) — its studies are skipped this run, other sites unaffected.`);
    }
  }
  if (results.length === 0) throw new Error("no studies found across any Altasciences site");
  return results;
}

// -------------------- Celerion (confirmed: /medical-study/<slug> detail pages) -----------------
// story: fix-study-deep-links. Live-verified 2026-08-09: helpresearch.com's own homepage links
// each listed study to its own /medical-study/<code>-<hash> detail page (e.g. Lincoln's
// "CA50785-5A" -> /medical-study/ca50785-5a-0x0000000000006bec), and that page publishes a
// structured STUDY NUMBER/GROUP NUMBER/STIPEND/AGE/BMI/WEIGHT RESTRICTION/STUDY LENGTH block —
// richer than what this tool had before (e.g. it corrects "CA50785-5A"'s own night count: the
// hand-entered seed had 9 nights, the page's own "STUDY LENGTH: 3 Night Stay & 2 Returns" says 3).
// Celerion's homepage also lists Belfast, UK studies (GBP, unrelated market) — filtered out below
// by currency/location, keeping only the US sites in data/networks.json (Lincoln NE, Tempe/Phoenix AZ).
const CELERION_US_CITIES = /lincoln|phoenix|tempe/i;

function parseCelerionField(text, label) {
  const m = text.match(new RegExp(`${label}:\\s*([^\\n]+)`, "i"));
  return m ? m[1].trim() : null;
}

async function pullCelerion(browser) {
  const listPage = await newPage(browser);
  let cards;
  try {
    await listPage.goto(cacheBustedUrl("https://helpresearch.com/"), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await listPage.waitForSelector('a[href*="/medical-study/"]', { state: "attached", timeout: 20_000 });
    await settleAfterSelector(listPage);
    cards = await listPage.$$eval('a[href*="/medical-study/"]', (as) => [
      ...new Set(as.map((a) => a.getAttribute("href") ?? "")),
    ]);
  } finally {
    await listPage.close();
  }

  const studies = [];
  for (const href of cards) {
    const detailUrl = new URL(href, "https://helpresearch.com").toString();
    const page = await newPage(browser);
    try {
      await page.goto(cacheBustedUrl(detailUrl), { waitUntil: "networkidle", timeout: 45_000 });
      const text = await page.$eval("body", (b) => b.innerText);

      // The detail page has no standalone "LOCATION:" field (confirmed live 2026-08-09) — the
      // site name only appears as the STUDY DATES table's own SITE column value. Matched directly
      // against Celerion's small, fixed set of real site names rather than a generic free-text
      // capture, so this can never mistake unrelated page text for a location.
      const location = text.match(/\b(Lincoln|Phoenix|Tempe|Belfast)\b/i)?.[1] ?? "";
      const currencyLine = text.match(/STIPEND:\s*up to\s*([£$])/i)?.[1] ?? "$";
      if (!CELERION_US_CITIES.test(location) || currencyLine !== "$") continue; // UK site — out of scope

      const studyNumber = parseCelerionField(text, "STUDY NUMBER");
      const groupNumber = parseCelerionField(text, "GROUP NUMBER");
      const id = [studyNumber, groupNumber].filter(Boolean).join("-");
      if (!id) continue; // page didn't match the expected structure — skip rather than guess an id

      const stipendM = text.match(/STIPEND:\s*up to\s*\$?([\d,]+(?:\.\d+)?)/i);
      const ageM = text.match(/AGE:\s*(\d+)\s*-\s*(\d+)/i);
      const bmiM = text.match(/BMI:\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/i);
      const weightM = text.match(/WEIGHT RESTRICTION:\s*minimum weight\s*(\d+)\s*lbs?/i);
      const lengthLine = parseCelerionField(text, "STUDY LENGTH") ?? "";
      const nightsM = lengthLine.match(/(\d+)\s*Night/i);
      const returnsM = lengthLine.match(/(\d+)\s*Return/i);
      const requirement = parseCelerionField(text, "STUDY REQUIREMENT") ?? "";

      studies.push({
        id,
        network: "Celerion",
        city: location.split(",")[0]?.trim() || "Lincoln",
        state: /phoenix|tempe/i.test(location) ? "AZ" : "NE",
        hub: /phoenix|tempe/i.test(location) ? "PHX" : "LINC",
        pay_gross: stipendM ? Math.round(parseFloat(stipendM[1].replace(/,/g, ""))) : null,
        currency: "USD",
        payout: { type: "unknown", settle_days: null },
        stays: nightsM ? [parseInt(nightsM[1], 10)] : null,
        visits: returnsM ? parseInt(returnsM[1], 10) : null,
        bmi_min: bmiM ? parseFloat(bmiM[1]) : null,
        bmi_max: bmiM ? parseFloat(bmiM[2]) : null,
        age_min: ageM ? parseInt(ageM[1], 10) : 18,
        age_max: ageM ? parseInt(ageM[2], 10) : 99,
        sex: parseSexFromText(requirement) ?? parseSexFromText(text) ?? "M/F",
        smoker: parseSmokerFromText(text) ?? "non",
        special_pop: null,
        min_weight_lb: weightM ? parseInt(weightM[1], 10) : undefined,
        eligible: true,
        status: "enrolling",
        source_url: detailUrl,
        phone: "1-866-348-4859",
        verified: new Date().toISOString().slice(0, 10),
        verified_by: "playwright-DOM",
        notes: requirement || undefined,
      });
    } catch (err) {
      warnAnnotation(`Celerion: failed to read study detail page ${detailUrl} (${err.message})`);
    } finally {
      await page.close();
    }
  }
  if (studies.length === 0) throw new Error("no US (Lincoln/Phoenix) medical-study pages found on helpresearch.com");
  return studies;
}

// -------------------- Frontage (confirmed: /clinical-studies/<slug>/ detail pages) --------------
// story: fix-study-deep-links. Live-verified 2026-08-09: frontagelab.com/enroll-in-a-study/'s own
// "Apply for this study" buttons link to a real, distinct detail page per study
// (/clinical-studies/<slug>/, e.g. "HYR-PB21" -> /clinical-studies/hyr-pb21/), each publishing its
// own BMI/age/nights/outpatient-visits/compensation prose. Only ever 1-2 studies active at a time.
async function pullFrontage(browser) {
  const listPage = await newPage(browser);
  let hrefs;
  try {
    await listPage.goto(cacheBustedUrl("https://www.frontagelab.com/enroll-in-a-study/"), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await listPage.waitForSelector("a[href*='/clinical-studies/']", { state: "attached", timeout: 20_000 });
    await settleAfterSelector(listPage);
    // Only the "Apply for this study" buttons -- confirmed live 2026-08-09 -- point at an actual
    // dated study with its own criteria. The SAME /clinical-studies/ URL namespace also hosts
    // evergreen "future consideration" pages ("Surgically Sterile Participants", "New Asian
    // Volunteers Needed", etc., each a "Click Here for Future Study Consideration" signup funnel,
    // not a specific study) — filtering by href alone would sweep those in too.
    hrefs = await listPage.$$eval("a[href*='/clinical-studies/']", (as) => [
      ...new Set(
        as
          .filter((a) => /apply for this study/i.test(a.textContent ?? ""))
          .map((a) => a.getAttribute("href") ?? "")
          .filter(Boolean)
      ),
    ]);
  } finally {
    await listPage.close();
  }

  const studies = [];
  for (const href of hrefs) {
    const detailUrl = new URL(href, "https://www.frontagelab.com").toString();
    const page = await newPage(browser);
    try {
      await page.goto(cacheBustedUrl(detailUrl), { waitUntil: "networkidle", timeout: 45_000 });
      const text = await page.$eval("body", (b) => b.innerText);

      // Study code is a short all-caps/numeric token in the page's own heading, e.g. "HYR-PB21" or
      // "HPN-01" (the "-V6.0" suffix on some headings is a document-revision marker, not part of
      // the study's own id — dropped to match this tool's existing id for this network).
      const idM = text.match(/\b([A-Z]{2,4}-[A-Z0-9]+?)(?:-V[\d.]+)?\b/);
      const id = idM ? idM[1] : (detailUrl.split("/").filter(Boolean).pop() ?? detailUrl);

      const eligText = parseEligibilityText(text);
      // Frontage's own phrasing is "Be 18 to 50 years old" -- the shared parseAgeFromDetailText
      // above expects an "ages?" prefix near the numbers or a hyphenated range, so it misses this
      // "to"-worded, non-"age"-prefixed sentence (confirmed live 2026-08-09); a small local
      // fallback catches it rather than silently shipping the 18-99 default for every study here.
      const frontageAgeM = text.match(/\bbe\s+(\d{1,3})\s*to\s*(\d{1,3})\s*years?\s*old/i);
      const age =
        parseAgeFromDetailText(text) ??
        (frontageAgeM ? { age_min: parseInt(frontageAgeM[1], 10), age_max: parseInt(frontageAgeM[2], 10) } : null);
      const { stays, visits } = parseNightsVisits(
        text
          .replace(/(\d+)\s+overnight\s*\(\d+\s*days?\)\s*stays?/i, (_m, n) => `1 stay of ${n} nights`)
          .replace(/(\d+)\s+overnight stays?/i, (_m, n) => `1 stay of ${n} nights`)
      );
      const visitsM = text.match(/(\d+)\s+outpatient visits?/i);

      studies.push({
        id,
        network: "Frontage",
        city: "Secaucus",
        state: "NJ",
        hub: "NJ",
        pay_gross: parsePay(text),
        currency: "USD",
        payout: { type: "unknown", settle_days: null },
        stays,
        visits: visitsM ? parseInt(visitsM[1], 10) : visits,
        bmi_min: eligText.bmi_min,
        bmi_max: eligText.bmi_max,
        age_min: age?.age_min ?? 18,
        age_max: age?.age_max ?? 99,
        sex: parseSexFromText(text) ?? "M/F",
        smoker: parseSmokerFromText(text) ?? "non",
        special_pop: eligText.special_pop,
        min_weight_lb: parseMinWeightLbFromText(text) ?? undefined,
        eligible: true,
        source_url: detailUrl,
        phone: "1-877-298-9071",
        verified: new Date().toISOString().slice(0, 10),
        verified_by: "playwright-DOM",
      });
    } catch (err) {
      warnAnnotation(`Frontage: failed to read study detail page ${detailUrl} (${err.message})`);
    } finally {
      await page.close();
    }
  }
  if (studies.length === 0) throw new Error("no /clinical-studies/ detail pages found on frontagelab.com");
  return studies;
}

// -------------------- Nucleus Network (confirmed: /trial/<slug>/ detail pages) -------------------
// story: fix-study-deep-links. Live-verified 2026-08-09: nucleusnetwork.com's
// /participants/find-a-trial/ defaults to Australia (?_trial_country_radio=au) unless
// ?_trial_country_radio=us is passed — the US filter is what surfaces the Minneapolis (MSP) studies
// this tool tracks. Each study links to its own /trial/<slug>/ page, which ends with a compact "Are
// you a match?" block (Age/Remuneration/Gender/BMI/Commitment) that's far more reliable to parse
// than the marketing prose above it.
async function pullNucleus(browser) {
  const listPage = await newPage(browser);
  let hrefs;
  try {
    await listPage.goto(
      cacheBustedUrl("https://nucleusnetwork.com/participants/find-a-trial/?_trial_country_radio=us"),
      { waitUntil: "domcontentloaded", timeout: 30_000 }
    );
    await listPage.waitForSelector("a[href*='/trial/']", { state: "attached", timeout: 20_000 });
    await settleAfterSelector(listPage);
    hrefs = await listPage.$$eval("a[href*='/trial/']", (as) => [
      ...new Set(as.map((a) => (a.getAttribute("href") ?? "").split("#")[0]).filter((h) => /\/trial\/[a-z0-9-]+\/?$/i.test(h))),
    ]);
  } finally {
    await listPage.close();
  }

  const studies = [];
  for (const href of hrefs) {
    const detailUrl = new URL(href, "https://www.nucleusnetwork.com").toString();
    const page = await newPage(browser);
    try {
      await page.goto(cacheBustedUrl(detailUrl), { waitUntil: "networkidle", timeout: 45_000 });
      const text = await page.$eval("body", (b) => b.innerText);

      const locationM = text.match(/Location\s*\n+\s*([^\n]+)/i);
      if (!locationM || !/minneapolis|msp/i.test(locationM[1])) continue; // this tool only tracks the MSP hub

      const title = (await page.title()).replace(/\s*\|\s*Nucleus Network\s*$/i, "").trim();
      const id = title.replace(/^The\s+/i, "").replace(/\s+Study$/i, "").trim() || title;

      // The "Are you a match?" block near the bottom of the page — confirmed live 2026-08-09 to be
      // present, in this field order, on every US study sampled.
      const matchM = text.match(
        /Are you a match\?[\s\S]*?Age\s*\n+\s*(\d+)\s*-\s*(\d+)[\s\S]*?Gender\s*\n+\s*([^\n]+)[\s\S]*?BMI\s*\n+\s*BMI\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)[\s\S]*?Commitment\s*\n+\s*(?:(\d+)\s*nights?,\s*)?(\d+)\s*clinic visits?/i
      );

      const genderText = matchM?.[3] ?? "";
      const sex = /female/i.test(genderText) && !/\bmale\b/i.test(genderText.replace(/female/gi, ""))
        ? "female"
        : /\bmale\b/i.test(genderText) && !/female/i.test(genderText)
          ? "male"
          : "M/F";

      studies.push({
        id,
        network: "Nucleus",
        city: "Minneapolis",
        state: "MN",
        hub: "MSP",
        pay_gross: parsePay(text.match(/Remuneration\s*\n+\s*\$[\d,]+/i)?.[0] ?? text),
        currency: "USD",
        payout: { type: "unknown", settle_days: null },
        stays: matchM?.[6] ? [parseInt(matchM[6], 10)] : null,
        visits: matchM?.[7] ? parseInt(matchM[7], 10) : null,
        bmi_min: matchM ? parseFloat(matchM[4]) : null,
        bmi_max: matchM ? parseFloat(matchM[5]) : null,
        age_min: matchM ? parseInt(matchM[1], 10) : 18,
        age_max: matchM ? parseInt(matchM[2], 10) : 99,
        sex,
        smoker: /occasional smoker/i.test(text) ? "any" : /non-smoker/i.test(text) ? "non" : "any",
        special_pop: null,
        eligible: true,
        status: "enrolling",
        source_url: detailUrl,
        phone: "612-315-6490",
        verified: new Date().toISOString().slice(0, 10),
        verified_by: "playwright-DOM",
        notes: title || undefined,
      });
    } catch (err) {
      warnAnnotation(`Nucleus: failed to read study detail page ${detailUrl} (${err.message})`);
    } finally {
      await page.close();
    }
  }
  if (studies.length === 0) throw new Error("no Minneapolis /trial/ detail pages found on nucleusnetwork.com");
  return studies;
}

// -------------------- PPD / Thermo Fisher (Trialmed) (confirmed: /studies/<slug>/ pages) --------
// story: fix-study-deep-links. docs/DATA-INTEGRITY.md's own incident log (2026-08-08) concluded
// "trialmed.com web-lists ONLY patient/ethnobridging studies" and that healthy-volunteer Phase-1
// studies were phone-only there — that was correct AS OF that date. Re-checked live one day later
// (2026-08-09, this story): trialmed.com/find-a-study/ now lists numerous studies whose own
// Therapy area(s) tag is plainly "Healthy volunteers" (e.g. /studies/3132098-lv-sad/, Las Vegas, Up
// to $9,050, Requirements say "Healthy Volunteers" with no diagnosed condition) — a real change on
// Trialmed's own site, not a repeat of the prior fabrication (every figure below is read directly
// off that study's own live detail page, the same "Age:/Sex:/BMI:/<smoker>" structured line every
// page ends its Requirements section with, and cross-checked against its own Compensation field —
// Rule 3). This does NOT relax scope: only rows whose Therapy area(s) list includes "Healthy
// volunteers" are kept (drops the many diagnosed-condition-required patient studies also listed,
// e.g. COPD/high-blood-pressure/kidney-disease rows) and only Austin/Las Vegas are kept (this
// tool's confinement-unit hubs — San Antonio is late-phase outpatient only per data/networks.json).
const TRIALMED_MAX_PAGES = 6;
const TRIALMED_HUBS = { austin: { state: "TX", hub: "AUS" }, "las vegas": { state: "NV", hub: "LV" } };

async function pullPPDThermo(browser) {
  const hrefs = new Set();
  for (let p = 1; p <= TRIALMED_MAX_PAGES; p++) {
    const page = await newPage(browser);
    try {
      const url = cacheBustedUrl(`https://trialmed.com/find-a-study/${p > 1 ? `?paged=${p}` : ""}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForSelector('a[href*="/studies/"]', { state: "attached", timeout: 20_000 });
      await settleAfterSelector(page);
      const pageHrefs = await page.$$eval('a[href*="/studies/"]', (as) =>
        as.map((a) => a.getAttribute("href") ?? "").filter((h) => /\/studies\/[a-z0-9-]+\/?$/i.test(h))
      );
      if (pageHrefs.length === 0) break;
      const before = hrefs.size;
      for (const h of pageHrefs) hrefs.add(h);
      if (hrefs.size === before) break; // repeated the previous page — end of pagination
    } catch (err) {
      warnAnnotation(`PPD/Thermo: failed to read find-a-study page ${p} (${err.message})`);
      break;
    } finally {
      await page.close();
    }
  }

  const studies = [];
  for (const href of hrefs) {
    const detailUrl = new URL(href, "https://trialmed.com").toString();
    const page = await newPage(browser);
    try {
      await page.goto(cacheBustedUrl(detailUrl), { waitUntil: "networkidle", timeout: 45_000 });
      const text = await page.$eval("body", (b) => b.innerText);
      const pageTitle = await page.title();

      const therapyAreas = text.match(/Therapy area\(s\)\s*\n\s*([^\n]+)/i)?.[1] ?? "";
      if (!/healthy volunteers/i.test(therapyAreas)) continue; // patient/diagnosed-condition study — out of scope

      const locationText = text.match(/Location\s*\n\s*([^\n]+)/i)?.[1]?.trim().toLowerCase() ?? "";
      const hubInfo = TRIALMED_HUBS[locationText];
      if (!hubInfo) continue; // not Austin/Las Vegas — out of this tool's confinement-unit scope

      // Every page sampled 2026-08-09 ends its Requirements section with this exact compact block —
      // the most reliable field to parse (vs. the free-form prose above it).
      const summaryM = text.match(/Age:\s*(\d+)-(\d+)\s*\nSex:\s*([^\n]+)\s*\nBMI:\s*(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\s*\n([^\n]+)/i);
      // The real study id is NOT reliably in the visible body text -- confirmed live 2026-08-09
      // against /studies/3119492-mad-lv/: its own body text's first 5-7 digit number is "40400"
      // (the compensation figure), and "3119492" never appears in the rendered page text at all,
      // only in the URL slug and the <title> tag. A body-text-first search would misread the pay
      // figure as the id (real bug caught while building this puller) -- the <title> tag is the
      // one place confirmed to consistently lead with the real study number on every page sampled
      // (including /studies/ethnobridging1/, whose URL slug itself has no digits either), so it's
      // tried first; the body text and the URL slug are only fallbacks if that ever fails.
      const idM =
        pageTitle.match(/^(\d{5,7})/) ?? detailUrl.match(/(\d{5,7})/) ?? text.match(/(\d{5,7})/);
      if (!idM) continue; // no numeric study id found anywhere — don't invent one

      const sexText = summaryM?.[3] ?? "";
      const nonChildbearing = /non-child-bearing/i.test(sexText);
      const sex = /\bF\b.*\bor\b.*\bM\b|\bM\b.*\bor\b.*\bF\b/i.test(sexText)
        ? "M/F"
        : /\bF\b/i.test(sexText)
          ? "female"
          : /\bM\b/i.test(sexText)
            ? "male"
            : "M/F";

      const isEthnobridging = /ethnobridging/i.test(therapyAreas);
      const descentM = text.match(/(Japanese|Chinese)\s+descent/gi);
      let special_pop = null;
      let eligible;
      let exclude_reason;
      if (isEthnobridging && descentM) {
        special_pop = "asian_descent_required";
        eligible = false;
        exclude_reason = `Ethnobridging — requires ${[...new Set(descentM.map((d) => d.split(/\s+/)[0]))].join("/")} descent.`;
      } else if (nonChildbearing && sex === "female") {
        // "Non-child-bearing F or M" (e.g. study 3142480, confirmed live 2026-08-09) is open to
        // BOTH sexes -- only gate this on sex/childbearing status when the page's own Sex line
        // says female ONLY (e.g. "Non-child-bearing F"), never merely because the phrase
        // "non-child-bearing" appears somewhere in a line that also allows males.
        eligible = false;
        exclude_reason = "Non-childbearing female only.";
      } else if (/overweight|obes/i.test(text)) {
        special_pop = "overweight_obese";
      }

      const compensationM = text.match(/Compensation\s*\n\s*Up to\s*\$?([\d,]+)/i);
      const statusText = text.match(/Status\s*\n\s*([^\n]+)/i)?.[1]?.trim();

      studies.push({
        id: idM[1],
        network: "PPD/Thermo",
        city: locationText === "las vegas" ? "Las Vegas" : "Austin",
        state: hubInfo.state,
        hub: hubInfo.hub,
        pay_gross: compensationM ? parseInt(compensationM[1].replace(/,/g, ""), 10) : parsePay(text),
        currency: "USD",
        payout: { type: "unknown", settle_days: null },
        stays: null, // not published on the detail page — phone-confirm per docs/DATA-SOURCES.md
        visits: null,
        bmi_min: summaryM ? parseFloat(summaryM[4]) : null,
        bmi_max: summaryM ? parseFloat(summaryM[5]) : null,
        age_min: summaryM ? parseInt(summaryM[1], 10) : 18,
        age_max: summaryM ? parseInt(summaryM[2], 10) : 99,
        sex,
        smoker: parseSmokerFromText(summaryM?.[6] ?? text) ?? "non",
        special_pop,
        ...(eligible === false ? { eligible, exclude_reason } : {}),
        status: statusText ? statusText.toLowerCase() : "enrolling",
        source_url: detailUrl,
        phone: "877-362-2608",
        verified: new Date().toISOString().slice(0, 10),
        verified_by: "playwright-DOM",
      });
    } catch (err) {
      warnAnnotation(`PPD/Thermo: failed to read study detail page ${detailUrl} (${err.message})`);
    } finally {
      await page.close();
    }
  }
  if (studies.length === 0) throw new Error("no Austin/Las Vegas healthy-volunteer studies found on trialmed.com");
  return studies;
}

// -------------------- Automated pullers registry --------------------
// Keyed by the exact `network` string used in data/studies.seed.json rows.

const PULLERS = {
  ICON: pullICON,
  Fortrea: pullFortrea,
  Spaulding: pullSpaulding,
  "JBR/CenExel": pullJBR,
  Altasciences: pullAltasciences,
  Celerion: pullCelerion,
  Frontage: pullFrontage,
  Nucleus: pullNucleus,
  "PPD/Thermo": pullPPDThermo,
};

// -------------------- Portal-reachability-only checks --------------------
// No confirmed DOM extraction recipe documented for these yet (phone-only / register-gated /
// roster-DB per docs/DATA-SOURCES.md). We still visit with a cache-buster so a hard outage is
// visible, but we never synthesize studies from an unconfirmed selector. Prior data is retained.
//
// story: fix-study-deep-links -- PPD/Thermo, Celerion, Altasciences, Nucleus, and Frontage moved
// up into PULLERS above (all 5 confirmed live 2026-08-09 to publish real per-study detail pages).
// Worldwide and BioPharma Services stay here: live-verified 2026-08-09, Worldwide's
// /participate-in-a-study/ page shows its one open study's own id/BMI/pay inline but has no
// separate per-study URL at all (an in-page anchor is the closest thing, and with only ever one
// study open it's not a distinguishable "recipe" the way every PULLERS entry above is) -- kept
// honest instead per this story's own risk note (a network can stay phone-only rather than force a
// link that can't be trusted to keep meaning "this specific study" if a second one opens).
// BioPharma Services (Toronto) was out of this story's 8-network scope and untouched.
const PORTAL_ONLY_CHECK = {
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
