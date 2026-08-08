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
// script — see the story's final report for the recon transcript). Every other confirmed network
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

    const studies = cards
      .filter((c) => c.id && c.href)
      .map((c) => {
        const source_url = new URL(c.href, "https://iconstudies.com").toString();
        const apply_url = c.applyHref
          ? new URL(c.applyHref, "https://iconstudies.com").toString()
          : undefined;
        const [city, state] = c.location.split(",").map((s) => s.trim());
        const hubKey = new URL(source_url).pathname.split("/")[1]?.toLowerCase() ?? "";
        const hub = ICON_HUBS[hubKey] ?? hubKey.toUpperCase();
        const { stays, visits } = parseNightsVisits(c.details);
        const { age_min, age_max } = parseAgeRange(c.age);
        const isOverweightStudy = /overweight|obese/i.test(c.title);

        return {
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
          bmi_min: null,
          bmi_max: null,
          age_min,
          age_max,
          sex: /female/i.test(c.sex) && !/male\/female/i.test(c.sex) ? "female" : "M/F",
          smoker: /non_smoker/i.test(c.smokerIconHref) ? "non" : "any",
          special_pop: isOverweightStudy ? "overweight_obese" : null,
          status: c.status ? c.status.toLowerCase() : "enrolling",
          source_url,
          apply_url,
          verified: new Date().toISOString().slice(0, 10),
          verified_by: "playwright-DOM",
          notes: c.title || undefined,
        };
      });

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
    const studies = rows
      .map((r) => {
        const source_url = new URL(r.href, "https://www.fortreaclinicaltrials.com").toString();
        const idMatch = r.titleCellText.match(/(\d{5,7})/);
        let id = idMatch ? idMatch[1] : source_url.split("/").pop() ?? r.title;
        const dupeCount = seenIds.get(id) ?? 0;
        seenIds.set(id, dupeCount + 1);
        if (dupeCount > 0) id = `${id}-${dupeCount + 1}`; // disambiguate cohort variants sharing an ID
        const hubInfo = FORTREA_HUBS.find((h) => h.match.test(r.location)) ?? null;
        const [city] = r.location.split(",").map((s) => s.trim());
        const { stays, visits } = parseNightsVisits(
          r.design.replace(/(\d+)\s+to\s+(\d+)\s+nights/i, (_m, a) => `1 stay of ${a} nights`)
        );
        const { age_min, age_max } = parseAgeRange(r.age);

        return {
          id,
          network: "Fortrea",
          city: city ?? "",
          state: hubInfo?.state ?? "",
          hub: hubInfo?.hub ?? "",
          pay_gross: parsePay(r.compensation),
          currency: "USD",
          payout: { type: "unknown", settle_days: null },
          stays,
          visits,
          bmi_min: null,
          bmi_max: null,
          age_min,
          age_max,
          sex: "M/F", // not exposed on the listing table; per-study detail page has the exact filter
          smoker: /^y/i.test(r.smoker) ? "any" : "non",
          special_pop: null,
          status: "enrolling",
          source_url,
          phone: "1-866-429-3700",
          verified: new Date().toISOString().slice(0, 10),
          verified_by: "playwright-DOM",
          notes: r.title || undefined,
        };
      })
      // Fortrea's DFW/FL/WI units are the ones in data/networks.json — skip any other state
      // that appears on the national table (out of scope for this tool's network list).
      .filter((s) => s.hub);

    return studies;
  } finally {
    await page.close();
  }
}

// -------------------- Spaulding Clinical (confirmed: /study/<slug>/ detail pages) -------------

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
        sex: "M/F",
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
    const studies = healthy.map((r) => {
      const { age_min, age_max } = parseAgeRange(r.age);
      return {
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
        bmi_min: null,
        bmi_max: null,
        age_min,
        age_max,
        sex: "M/F",
        smoker: "any",
        special_pop: null,
        status: r.status ? r.status.toLowerCase() : "enrolling",
        source_url: r.href,
        phone: "801-261-2000",
        verified: new Date().toISOString().slice(0, 10),
        verified_by: "playwright-DOM",
        notes: r.title,
      };
    });
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

main().catch((err) => {
  console.error("[pull-studies] fatal error:", err);
  process.exit(1);
});
