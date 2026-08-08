// Server-side "add a study by URL" support — pure text parsing + known-domain
// matching, framework-free (no fetch, no browser/Node API) so it's
// unit-testable the same way lib/scoring.ts is. app/api/pull-study/route.ts
// is the only caller that actually performs the network fetch; this module
// only ever sees strings it's handed.
//
// Research finding (this story's `research` step) on the Playwright-vs-fetch
// question the story's acceptance criteria asks to resolve, not assume away:
//
// docs/DATA-SOURCES.md's "golden rule" requires a headless browser
// (Playwright) + cache-buster ONLY for each network's JS-rendered, cached
// *listing* page — scripts/pull-studies.mjs exists because of that. But this
// story hands a single *study detail page* URL a visitor pastes in, not a
// listing — and that same doc says plainly: "Individual study detail pages
// usually fetch fine (good for BMI/nights)." ICON's own pull_method note in
// data/networks.json repeats it: "Detail pages fetch fine for BMI."
//
// Standing up Playwright inside a Vercel serverless function (via
// playwright-core + @sparticuz/chromium, the standard workaround for
// headless Chrome on Lambda-style runtimes) is possible, but it's a real
// dependency addition (tens of MB, pushing toward Vercel's 250MB unzipped
// function-size ceiling once stacked on Next.js's own output), a multi-second
// cold start that risks Vercel Hobby's tight default function timeout, and a
// second Playwright surface to maintain alongside scripts/pull-studies.mjs's
// existing one (which runs in GitHub Actions, not serverless, and stays
// there unchanged). That tradeoff isn't justified for a single detail-page
// fetch when a plain server-side `fetch()` already does the job per the
// docs above, and it directly contradicts design-discussion.md §9's "keep it
// as cheap and free and miniscule as possible" architecture call. So: this
// story's API route (app/api/pull-study/route.ts) uses a plain Node-runtime
// `fetch()` with a cache-buster query param (same courtesy convention as the
// Playwright puller), NOT Playwright. If a future network's detail pages
// turn out to be JS-rendered too, that network simply won't pre-fill — the
// route already falls back to a blank manual-entry form for any pull that
// fails, satisfying this story's AC2 either way.

/** Pay text like "$22,524 to $23,132" | "Up to $32,500" -> 32500 (ceiling
 * figure — pay is always "up to", never a fabricated single number, matching
 * scripts/pull-studies.mjs's parsePay). */
export function parsePay(text: string | null | undefined): number | null {
  if (!text) return null;
  const nums = [...text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) =>
    Math.round(parseFloat(m[1].replace(/,/g, ""))),
  );
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

/** "Age 18 - 55" | "18-70" | "18+" -> {age_min, age_max}, defaulting to
 * 18-99 (an unconstrained range, not a guessed cap) when nothing matches. */
export function parseAgeRange(text: string | null | undefined): { age_min: number; age_max: number } {
  if (!text) return { age_min: 18, age_max: 99 };
  const range = text.match(/(\d{1,3})\s*(?:-|to)\s*(\d{1,3})/i);
  if (range) return { age_min: parseInt(range[1], 10), age_max: parseInt(range[2], 10) };
  const plus = text.match(/(\d{1,3})\s*\+/);
  if (plus) return { age_min: parseInt(plus[1], 10), age_max: 99 };
  return { age_min: 18, age_max: 99 };
}

// A single study's own "Participation in this study includes ..." sentence
// is where every "N stay(s) of M nights" clause we care about lives — live
// testing against a real ICON detail page (see this story's final report)
// found that sentence verbatim-repeated 3 times on one page (hero blurb,
// secondary summary, FAQ), each repeat 350+ chars apart. Matching stay
// phrases globally across the whole scope re-counted the same real stays
// 3x over. Bounding the search to a NIGHTS_CLUSTER_CHARS window right after
// the *first* match keeps every clause of that one sentence (they sit
// within ~90 chars of each other) while stopping well before the sentence's
// own repeats reappear.
const NIGHTS_CLUSTER_CHARS = 300;

/** "1 stay of 10 nights" / "2 separate stays of 6 nights" -> stays list;
 * "14 follow-up visits" -> visit count. Mirrors
 * scripts/pull-studies.mjs's parseNightsVisits, plus the repeated-sentence
 * windowing above (pull-studies.mjs doesn't need it — it reads one isolated
 * DOM node per network, not a flattened whole-page text blob). */
export function parseNightsVisits(text: string | null | undefined): {
  stays: number[] | null;
  visits: number | null;
} {
  if (!text) return { stays: null, visits: null };
  const stayRe = /(\d+)\s+(?:separate\s+)?stays?\s+of\s+(\d+)\s+nights?/gi;
  const firstMatch = stayRe.exec(text);
  const stays: number[] = [];
  if (firstMatch) {
    const cluster = text.slice(firstMatch.index, firstMatch.index + NIGHTS_CLUSTER_CHARS);
    const clusterRe = /(\d+)\s+(?:separate\s+)?stays?\s+of\s+(\d+)\s+nights?/gi;
    let m: RegExpExecArray | null;
    while ((m = clusterRe.exec(cluster))) {
      const count = parseInt(m[1], 10);
      const nights = parseInt(m[2], 10);
      for (let i = 0; i < count; i++) stays.push(nights);
    }
  }
  const visitsM = text.match(/(\d+)\s+follow-up (?:outpatient )?visits?/i);
  const visits = visitsM ? parseInt(visitsM[1], 10) : null;
  return { stays: stays.length ? stays : null, visits };
}

/** "BMI: Between 18 and 32" | "BMI 18-32" -> {bmi_min, bmi_max}, both null
 * when nothing matches (never guessed — same "confirm on call" default the
 * rest of the app uses for an unknown BMI gate). */
export function parseBmiRange(text: string | null | undefined): {
  bmi_min: number | null;
  bmi_max: number | null;
} {
  if (!text) return { bmi_min: null, bmi_max: null };
  const m = text.match(/BMI[^0-9]{0,20}(\d{1,2}(?:\.\d+)?)\s*(?:-|to|and)\s*(\d{1,2}(?:\.\d+)?)/i);
  if (!m) return { bmi_min: null, bmi_max: null };
  return { bmi_min: parseFloat(m[1]), bmi_max: parseFloat(m[2]) };
}

/** "must weigh at least 110 lbs" -> 110. */
export function parseMinWeight(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/at least\s*(\d+)\s*lbs?/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Strips <script>/<style> blocks entirely, then all remaining tags, then
 * collapses whitespace — a plain-text approximation of a browser's
 * `body.innerText` good enough for regex extraction, with no DOM/HTML
 * parser dependency. Never throws on malformed HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const title = htmlToText(m[1]).trim();
  return title || null;
}

export interface ExtractedFields {
  title: string | null;
  pay_gross: number | null;
  age_min: number;
  age_max: number;
  stays: number[] | null;
  visits: number | null;
  bmi_min: number | null;
  bmi_max: number | null;
  min_weight_lb: number | null;
}

// Live-verified against a real ICON detail page while building this story
// (see the story's final report): a study detail page's *own* hero +
// description + FAQ content is consistently followed, further down the
// page, by a "you might also be interested in" / related-studies widget
// that repeats the same "N stay(s) of M nights" / "$X" phrasing for a
// handful of *other* studies. Parsing the full page text made
// parseNightsVisits accumulate stray stays from those unrelated studies
// (one real page produced a bogus 29-entry stays list) and put parsePay's
// Math.max at risk of picking another study's higher headline figure.
// Scoping extraction to only the first EXTRACTION_WINDOW_CHARS of body text
// keeps the target study's own content (confirmed to comfortably fit
// within this window on the page tested) while excluding that widget —
// simple, dependency-free, and consistent with this being a best-effort
// pre-fill the visitor always reviews before confirming (AC3), not a
// guarantee of correctness for every network's page layout.
const EXTRACTION_WINDOW_CHARS = 2000;

/** Best-effort field extraction from a study detail page's raw HTML. Never
 * throws — a page with none of these patterns just yields an
 * all-nulls-except-age-range result, same as any other "confirm on call"
 * unknown field elsewhere in this app. */
export function extractStudyFields(html: string): ExtractedFields {
  const scope = htmlToText(html).slice(0, EXTRACTION_WINDOW_CHARS);
  const { age_min, age_max } = parseAgeRange(scope);
  const { stays, visits } = parseNightsVisits(scope);
  const { bmi_min, bmi_max } = parseBmiRange(scope);
  return {
    title: extractTitle(html),
    pay_gross: parsePay(scope),
    age_min,
    age_max,
    stays,
    visits,
    bmi_min,
    bmi_max,
    min_weight_lb: parseMinWeight(scope),
  };
}

// ---- known-network domain matching (AC1: "a study URL from a known network
// per data/networks.json") ----------------------------------------------

/** Pulls every http(s) hostname mentioned anywhere in data/networks.json
 * (portal fields, per-site portal fields, notes) — same approach used to
 * verify the domain list in this story's research step. Doesn't try to
 * structure-parse each network's shape (a `portal` field is sometimes a
 * URL, sometimes free text like "pending (West/SLC pull)"); a blunt
 * URL-regex sweep over the whole file is more robust to that inconsistency
 * than field-by-field parsing, and this list only ever gates a pre-fill
 * *attempt* — getting it slightly under-inclusive just means one more
 * network falls back to manual entry (AC2), never an error. */
export function knownNetworkDomains(networksJsonText: string): Set<string> {
  const domains = new Set<string>();
  const matches = networksJsonText.matchAll(/https?:\/\/[^\s"]+/g);
  for (const m of matches) {
    try {
      const host = new URL(m[0]).hostname.replace(/^www\./i, "").toLowerCase();
      if (host) domains.add(host);
    } catch {
      // malformed URL fragment in the JSON text — skip, not fatal.
    }
  }
  return domains;
}

/** True if `url`'s hostname is (or is a subdomain of) one of `domains`. */
export function isKnownNetworkUrl(url: string, domains: Set<string>): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return false;
  }
  for (const d of domains) {
    if (host === d || host.endsWith(`.${d}`)) return true;
  }
  return false;
}

/** Appends a cache-buster query param, matching
 * scripts/pull-studies.mjs's cacheBustedUrl convention — the same courtesy
 * (and cache-avoidance) applied to the study-detail fetch this route makes. */
export function cacheBustedUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.set("nocache", Date.now().toString());
  return u.toString();
}

/** Only http(s) URLs are ever fetched server-side — rejects file:, data:,
 * javascript:, etc. before this URL is handed to fetch(). */
export function isFetchableHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
