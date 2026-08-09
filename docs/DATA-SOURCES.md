# Data sources — the national pull directory

The full network directory (portals, phones, sites, pull method) is machine-readable in
`data/networks.json`. This doc is the human summary + the refresh playbook.

## The golden rule

Study sites are **JS-rendered and heavily cached** (W3 Total Cache, Salesforce portals). A plain
`fetch`/WebFetch returns a **stale or partial** list — you will miss the newest, highest-paying
studies (this is how the top $32.5k and $40.4k studies were nearly missed). **Pull via a headless
browser (Playwright) with a cache-buster** (`?nocache=<timestamp>`) and extract the DOM. Individual
study **detail** pages usually fetch fine (good for BMI/nights). `pay` is "up to"; **payout schedule
is a phone-only field.**

## Confirmed paid-Phase-1 / healthy-volunteer networks (verified 2026-08-08)

| Network | Sites | Portal | Notes |
|---|---|---|---|
| **PPD / Thermo Fisher** (brand **Trialmed**) | Austin TX, Las Vegas NV (early-phase) | trialmed.com/find-a-study | Biggest checks (Vegas MAD $40k). Austin = in-city. Nights often hidden → phone. |
| **ICON** | SLC, San Antonio, Lenexa KS | iconstudies.com | W3TC-cached — Playwright + cache-buster mandatory. Best mid-tier depth. |
| **Fortrea** | Dallas TX, Daytona FL, Madison WI | fortreaclinicaltrials.com | Exact nights/visits on per-study pages. $100/visit stipend (Daytona/Madison). Dallas drivable from Austin. |
| **Altasciences** | Overland Park KS, Cypress CA (=WCCT), Montreal QC | participants{kc,la,mtl}.altasciences.com | BMI screening-gated. ClinCard pay. KC drivable from Omaha. |
| **Celerion** | Lincoln NE, Tempe AZ | helpresearch.com | Lincoln = Omaha backyard. BMI/nights via phone. |
| **Spaulding Clinical** | West Bend WI | spauldingpays.com | Publishes BMI/nights openly. WI friend childcare. |
| **Nucleus Network** | Minneapolis MN | nucleusnetwork.com/participants/find-a-trial | Publishes full data. Top study female-only. |
| **Frontage** | Secaucus NJ | frontagelab.com/enroll-in-a-study | BMI 18–32 posted. Philly/NYC friend childcare. |
| **JBR / Jean Brown Research (CenExel)** | Salt Lake City UT | cenexelresearch.com/jbr/all-studies | SLC childcare. Implant/healthy studies, long visit tails. |
| **BioPharma Services** | Toronto ON | biopharmaservices.com/volunteers | CAD. Mostly ON residents (operational). |
| **Worldwide** | San Antonio TX | worldwide.com/participate-in-a-study | 200-bed; get on list, no normal-BMI panel open now. |
| **CPMI** | Miami FL | cpmiclinical.com | Healthy roster phone-only; legit early-phase. |
| **QPS** | South Miami FL | miamiresearch.com | Patient/obese now; apply to DB. |

**Deprioritized / not a fit:** CenExel CNS sites (psychiatry patient trials), DM Clinical (Phase 2–4
outpatient), Innovaderm (dermatology patient), KGK (nutraceutical), Biotrial Newark (verify enrolling
— routes to Trialmed), Anaheim Clinical Trials (dead site).

## Aggregators (for expanding the pool)

- **withpower.com** — filter healthy + male + BMI 18–25
- **clinicaltrials.gov** — search "healthy volunteers" Phase 1 + location
- Referrals from his own network (friends send study links) — add via "add study by URL" → live-DOM puller.

## Refresh cadence

These cohorts cycle **weekly**. Re-pull the confirmed networks (Playwright + cache-buster) before any
call session; treat anything older than ~a week as stale. Always reconfirm pay + payout + nights on the
phone — the portal is a lead, the recruiter is the source of truth.

**This is now automated, daily, on top of that weekly staleness guidance** (belt + suspenders — see
`daily-refresh-scheduled` story): `.github/workflows/daily-study-refresh.yml` runs
`scripts/pull-studies.mjs` on a daily cron (`workflow_dispatch` also available for a manual run) and
commits `data/studies.seed.json` when it changes, so Vercel's git-integration redeploy picks it up.
Daily (not hourly) was a deliberate choice — see that story's `risks` for the "don't hammer the
network sites" reasoning; each run is one page load per automated network plus a lightweight
reachability check for the rest, well under anything that would look like scraping abuse.

`scripts/pull-studies.mjs` currently has a **confirmed, live-verified DOM extraction recipe for
ten networks**: ICON, Fortrea, Spaulding Clinical, JBR/CenExel's healthy-volunteer listing,
Altasciences (all 3 sites), Celerion, Frontage, Nucleus Network, PPD/Thermo Fisher (Trialmed), and
BioPharma Services (each is one function in `scripts/pull-studies.mjs`, one per network's
`pull_method` below).
Those are the only networks in the table above whose portal, as of this writing, publishes a
public, unauthenticated, enumerable study *listing* with a documented DOM structure — everything
else in the table is phone-only, register-gated, or a roster/DB submission per that network's own
notes, so there's no listing to automate against yet. For those, the script still visits the
portal with a cache-buster each run (to catch a hard outage) but does **not** synthesize study
rows from an unconfirmed selector — see `docs/DATA-INTEGRITY.md` on why guessing at structure is
exactly the failure mode to avoid. Extending automation to another network means finding and
documenting its concrete listing recipe here first, the same way ICON's was documented, then
adding a puller function.

**Extended 2026-08-09 (story: fix-study-deep-links):** a real user clicked a study link and landed
on a network's generic homepage instead of the specific study — two confirmed causes. (1) A real
Fortrea href-resolution bug: study 783120's own listing href is the bare `/120` (no descriptive
slug, unlike every sibling study) — live-verified to actually resolve to that exact study's own
page (id + pay both present), so `pullFortrea` now cross-checks any non-canonical-shaped href's
own page content before trusting it, and drops (rather than ships) anything that doesn't verify.
(2) Six of the "no listing recipe yet" networks above — Altasciences (all 3 sites), Celerion,
Frontage, Nucleus, and PPD/Thermo — had shipped their network's generic homepage/search URL AS
source_url, presented identically to a real per-study link; researched live and confirmed each
one *does* publish real per-study detail pages after all, so they moved from "portal-reachability
only" into the confirmed table above with their own recipes documented below. One correction this
surfaced along the way: Celerion study "CA50785-5A"'s hand-entered `stays` was `[9]`; its own
`/medical-study/` page states `STUDY LENGTH: 3 Night Stay & 2 Returns` — `[3]`. This story's own
acceptance criteria cover the WHOLE ranked table, not only the 8 originally-named networks, so
BioPharma Services (not one of the 8, but found with the exact same generic-URL-as-source_url
issue) got the same treatment: it also publishes real `/volunteer/<slug>/` pages. **Worldwide**
alone stays phone-only on purpose: it genuinely has no separate per-study URL (its one open
study's own id/BMI/pay show inline on `/participate-in-a-study/`, with no distinguishable
per-study address if a second study opens) — it keeps the honest "call to apply" UI treatment
(`components/ranked-table.tsx`) instead of a link.

| Network | Recipe |
|---|---|
| Altasciences KC | `participantskc.altasciences.com/available-studies` → per-study `/etudes/<id>` (same Drupal "Ajax Study Detail" module as MTL) |
| Altasciences LA | `participantsla.altasciences.com/current-studies` (paginated) → per-study `/current-studies/<code>-en-1` |
| Altasciences MTL | `participantsmtl.altasciences.com/en/available-studies` (English mirror) → per-study `/en/etudes/<id>` |
| BioPharma Services | `biopharmaservices.com/volunteers/` → per-study `/volunteer/study-no-<slug>/`, via each card's own "Study Details" link |
| Celerion | `helpresearch.com/` → per-study `/medical-study/<code>-<hash>`, filtered to US sites (Lincoln NE / Phoenix-Tempe AZ), Belfast UK excluded |
| Frontage | `frontagelab.com/enroll-in-a-study/` → per-study `/clinical-studies/<slug>/`, only the "Apply for this study" links (the same URL namespace also hosts non-study "future consideration" funnel pages) |
| Nucleus | `nucleusnetwork.com/participants/find-a-trial/?_trial_country_radio=us` (defaults to Australia without that query param) → per-study `/trial/<slug>/`, filtered to the Minneapolis (MSP) hub |
| PPD/Thermo (Trialmed) | `trialmed.com/find-a-study/` (paginated) → per-study `/studies/<slug>/`, filtered to Therapy area "Healthy volunteers" (drops the many diagnosed-condition patient studies also listed) and Austin/Las Vegas only |

**Fixed 2026-08-09 (story: scrape-detail-page-eligibility):** the automated pullers used to read
only what was on the *listing* card/row — pay, title, age range, and (where shown) nights/visits —
and never visited a study's own detail page, so real eligibility criteria that only showed up there
(a BMI floor/ceiling, a "GLP-1 medication"/"overweight or have obesity" special-population gate)
silently shipped as `null`. This was a real correctness bug, not just a coverage gap: a `null`
`bmi_min`/`bmi_max` means "unconfirmed, don't exclude" to `lib/scoring.ts`'s eligibility gate, so a
study that actually required a higher BMI showed as available to anyone. Confirmed live against a
Fortrea Madison "GLP-1 medication" study (id 781236, real BMI floor 25) and, on audit, several ICON
studies and one JBR study with the same gap. ICON, Fortrea, and JBR/CenExel's pullers now fetch each
study's own detail page too (`fetchDetailEligibility()` in `scripts/pull-studies.mjs`); Spaulding
already read its own detail page and only needed a separate fix (its sex line was never parsed —
the "Montgomery" study is female-only and had shipped as "M/F"). `bmi_min`/`bmi_max`/`special_pop`
still land as `null` (safe default — triggers the existing "confirm BMI on call" flag) exactly as
before whenever a detail page genuinely doesn't publish them; the fix is under-extraction, not a
promise that every study everywhere now has a BMI on file. Treat an automated refresh as keeping
listing *and* published-eligibility data current, not as a substitute for the phone confirmation
this doc has always required before anyone acts on a study.

## Coverage gaps to fill next

- West/SLC deep pull on **JBR/CenExel** current enrolling (not just upcoming) + **Parexel Las Vegas**
  (register-gated pay).
- **Celerion Tempe AZ** specific enrolling studies (register-gated).
- Second-tier units near friend metros: Atlanta (TrialMed), San Diego (So-Cal), Phoenix.
