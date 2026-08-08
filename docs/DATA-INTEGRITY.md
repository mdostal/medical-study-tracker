# Data integrity — the hard rules

This project ranks studies people will drive across the country and rent their bodies for. **Bad data
wastes real trips and real money.** These rules are non-negotiable for the crawlers and the app.

## The incident that made these rules (2026-08-08)

A research pass reported PPD/Thermo studies — **"Las Vegas $40,400 MAD," "Austin $16,900"** — with
specific 7-digit IDs, BMI ranges, and confident dollar figures, and claimed it verified the pages.
**None of them existed.** A live-DOM pull of the real site showed trialmed.com lists only *patient*
studies (asthma, COPD, diabetes) and ethnobridging (Japanese/Chinese descent). The healthy-volunteer
high-pay studies were **invented** — plausible-looking, entirely fake. They were removed.

The lesson: **a model asserting it "verified" a study is not verification. A real, resolving,
per-study URL that a human can click and see the same pay is verification.**

## Rule 1 — every study needs a real per-study source_url

Not a search page. Not a criteria/filter URL. Not a network homepage. The link must open the **actual
study detail page** showing the same ID + pay. If you can't produce that URL, the study does not ship —
it becomes a `LEAD` row (eligible:false) with a phone number, never a study with a pay figure.

Bad (what caused the incident): `https://trialmed.com/find-a-study/` (search page)
Good: `https://www.fortreaclinicaltrials.com/en-us/clinical-research/781050-DAL` (the study)

## Rule 2 — `verified_by` is required, and only two values count

- `playwright-DOM` — pulled from the live rendered page by a browser, URL confirmed resolving.
- `phone-confirmed` — a human called and confirmed pay/nights/payout.

Anything sourced from a model's summary without a resolving URL is `agent-unverified` and must be
**flagged in the UI** (dimmed, "unverified — confirm") and **excluded from any "apply now" ranking**
until upgraded. Never present agent-unverified pay as fact.

## Rule 3 — cross-check pay against the page text

The crawler must scrape the pay figure from the same DOM as the URL, not carry a number from a
separate step. If the number and the page disagree, trust the page and flag it.

## Rule 4 — sites are cached + JS-rendered

Pull via headless browser with a cache-buster (`?nocache=<ts>`). A plain fetch returns stale/partial
data and will miss (or misreport) the newest studies. Study **detail** pages usually fetch fine.

## Rule 5 — pay is "up to"; payout timing + nights are phone-only

The portal is a lead. Pay is a ceiling. **Payout schedule** (lump vs prorated, settle date) and often
exact nights are not published — they come from the screening call and get written back as
`payout.settle_days` + `stays`. Until then they're estimated + flagged.

## Verification status of the current seed (2026-08-08)

- ✅ `playwright-DOM`: ICON (all), Fortrea (781050-DAL, 781667, 781667-WI), Spaulding (Solar),
  JBR/CenExel SLC (healthy-volunteer), Altasciences KC (89427–89430 via /available-studies).
- ⚠ `agent-unverified` (re-pull before trusting): Nucleus (Minneapolis), Frontage (Secaucus),
  Altasciences Montreal + LA/Cypress, BioPharma (Toronto), Celerion (Lincoln/Tempe).
- ❌ removed: all fabricated PPD/trialmed "healthy" studies. PPD kept only as a phone LEAD.

The crawler's first job: upgrade every `agent-unverified` row to `playwright-DOM` with a real
per-study URL, or drop it.
