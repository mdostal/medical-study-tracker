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
four networks only**: ICON, Fortrea, Spaulding Clinical, and JBR/CenExel's healthy-volunteer
listing (each is one function in that file, one per network's `pull_method`). Those are the only
networks in the table above whose portal, as of this writing, publishes a public, unauthenticated,
enumerable study *listing* with a documented DOM structure — everything else in the table is
phone-only, register-gated, or a roster/DB submission per that network's own notes, so there's no
listing to automate against yet. For those, the script still visits the portal with a cache-buster
each run (to catch a hard outage) but does **not** synthesize study rows from an unconfirmed
selector — see `docs/DATA-INTEGRITY.md` on why guessing at structure is exactly the failure mode
to avoid. Extending automation to another network means finding and documenting its concrete
listing recipe here first, the same way ICON's was documented, then adding a puller function.

**Known gap vs. the manual/phone research pass:** the automated pullers read only what's on the
*listing* card/row — pay, title, age range, and (where shown) nights/visits. They do **not** dig into
per-study detail pages the way a manual pass has, so nuance that only shows up there (e.g. an
"asian descent required" or "documented high cholesterol required" `special_pop` gate) will not
carry forward automatically for a study that keeps showing up after a refresh. `bmi_min`/`bmi_max`
land as `null` (safe default — triggers the existing "confirm BMI on call" flag) rather than guessed.
Treat an automated refresh as keeping the *listing* current, not as a substitute for the phone
confirmation this doc has always required before anyone acts on a study.

## Coverage gaps to fill next

- West/SLC deep pull on **JBR/CenExel** current enrolling (not just upcoming) + **Parexel Las Vegas**
  (register-gated pay).
- **Celerion Tempe AZ** specific enrolling studies (register-gated).
- Second-tier units near friend metros: Atlanta (TrialMed), San Diego (So-Cal), Phoenix.
