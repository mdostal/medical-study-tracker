# medical-study-tracker

A decision engine for paid clinical-trial (Phase-1 / healthy-volunteer) participation, ranked by
**what you actually keep and how fast you get it** — not by the "up to $" headline.

It exists because the headline number lies. A $30k study that pays out over 6 months is worse bridge
cash than a $15k study that settles at the end of one month. A $22k study in a city where you have no
childcare can net less than a $6.6k study a friend lives 20 minutes from. This tool does that math.

## Why this is different from every "find a study" site

Those sites sort by gross pay and hide the eligibility gate until you've wasted a screening trip.
This one models the **real** decision:

- **Net cash kept** = gross − travel − childcare (using *your* base city, friend map, and nanny rate)
- **Cash velocity** = net ÷ days-until-actually-paid (the "$30k-in-6-months vs $15k-in-1-month" judge)
- **Downtime rate** = net ÷ total days of life committed (confinement + follow-up tail)
- **Feasibility gate** = can childcare actually be arranged for this stay, in this city, given a
  single parent? (friend-city / nanny-housesit / blocked)
- **Eligibility gate** = BMI, age, sex, smoker, special-population — filters out what you can't get
  before it wastes your time.

You tune the weights; it re-ranks. See `docs/SCORING.md`.

## Status / roadmap

- **Phase 0 (now):** private tool for the owner. Seed data in `data/`, working reference model in
  `prototype/net-value-model.html` (open it in a browser — it already ranks the seed studies live).
- **Phase 1 (hive build):** Next.js + TypeScript + Tailwind + shadcn app implementing `lib/scoring.ts`
  as the engine, `data/*.json` as seed, with tunable-weight UI, status tracking, and a national
  network directory. Supabase (Postgres + RLS) for multi-user later. See `docs/REQUIREMENTS.md`.
- **Phase 2 (public, later):** open it to others as a free tool on the site — **only after the owner's
  own cash need is met.** Not shared publicly at launch.

## Stack (intended — for the hive)

Next.js 15 (App Router) · TypeScript · Tailwind · shadcn/ui · Supabase (Postgres + RLS) · deployed on
the owner's existing infra. Mirror the conventions in the `personal-drone` / drone-hub repos.

## Layout

```
docs/
  REQUIREMENTS.md        product spec + data model + UX
  SCORING.md             the weighting/scoring algorithm (formulas) — the heart
  DATA-SOURCES.md        national CRO/site directory + how to pull each (live-DOM method)
  SCREENING-CALL-SCRIPT.md   dial-down-the-list call card, stats pre-filled, asks the payout question
data/
  studies.seed.json      confirmed enrolling studies (the base list)
  networks.json          the CRO network directory (verified + pending)
  friend-childcare-map.json   owner's friend cities → childcare likelihood → nearby study hubs
lib/
  types.ts               the schema (Study, Network, ScoreInputs, ScoredStudy)
  scoring.ts             reference implementation of the SCORING.md algorithm
prototype/
  net-value-model.html   working single-file prototype (ranks seed data live, tunable knobs)
```

## Ground rule for data (learned the hard way)

Study sites run heavy caching (W3 Total Cache etc.) and JS-render their listings. **A plain fetch
returns a stale/partial list.** Pull via headless browser (Playwright) with a **cache-buster query
param** (`?nocache=<ts>`) and extract the DOM. Individual study detail pages are usually current via
normal fetch. `pay` is always "up to" — reconfirm on the screening call, which is also where you get
the **payout schedule** (rarely published online). See `docs/DATA-SOURCES.md`.
