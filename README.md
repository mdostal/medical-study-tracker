# medical-study-tracker

A decision engine for paid clinical-trial (Phase-1 / healthy-volunteer) participation, ranked by
**what you actually keep and how fast you get it** — not by the "up to $" headline.

It exists because the headline number lies. A $30k study that pays out over 6 months is worse bridge
cash than a $15k study that settles at the end of one month. A $22k study in a city where you have no
childcare can net less than a $6.6k study a friend lives 20 minutes from. This tool does that math.

## Why this is different from every "find a study" site

Those sites sort by gross pay and hide the eligibility gate until you've wasted a screening trip.
This one models the **real** decision:

- **Net cash kept** = gross − travel − backup care (using *your* home base, backup-care coverage map,
  and your own backup-care rate)
- **Cash velocity** = net ÷ days-until-actually-paid (the "$30k-in-6-months vs $15k-in-1-month" judge)
- **Downtime rate** = net ÷ total days of life committed (confinement + follow-up tail)
- **Feasibility gate** = is the stay short enough to be easy, given the user's own away-time tolerance?
  (short stay / doable with paid backup care / too long — blocked)
- **Eligibility gate** = BMI, age, sex, smoker, special-population — filters out what you can't get
  before it wastes your time.

You tune the weights; it re-ranks. See `docs/SCORING.md`.

## Status / roadmap

- **Phase 0 (now):** private tool for the owner's own use. Seed data in `data/`, working reference
  model in `prototype/net-value-model.html` (open it in a browser — it already ranks the seed studies
  live).
- **Phase 1 (hive build):** Next.js + TypeScript + Tailwind + shadcn app implementing `lib/scoring.ts`
  as the engine, `data/*.json` as seed, with tunable-weight UI, status tracking, and a national
  network directory. See `docs/REQUIREMENTS.md`.
- **Phase 2 (public):** ships as a free, public tool linked from the owner's site — no accounts, no
  backend; every visitor's profile and status state persist in their own browser via `localStorage`,
  with a shareable link that encodes the profile for sharing a specific ranking view.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · shadcn/ui. No accounts, no backend, no database —
every visitor's profile and status state persist locally in their own browser via `localStorage`
(see `.pHive/epics/public-launch/docs/design-discussion.md` §9).

## Layout

```
app/
  layout.tsx, page.tsx    Next.js App Router entry points (Server Components by default)
components/
  ui/                     shadcn/ui components (Table, Card, Button, ...)
  *.tsx                   app-specific components ("use client" where interactive)
docs/
  REQUIREMENTS.md        product spec + data model + UX
  SCORING.md             the weighting/scoring algorithm (formulas) — the heart
  DATA-SOURCES.md        national CRO/site directory + how to pull each (live-DOM method)
  SCREENING-CALL-SCRIPT.md   dial-down-the-list call card, stats pre-filled, asks the payout question
data/
  studies.seed.json      confirmed enrolling studies (the base list)
  networks.json          the CRO network directory (verified + pending)
  friend-childcare-map.json   study hub coordinates + user-stated free backup-care coverage per hub
lib/
  types.ts               the schema (Study, Network, ScoreInputs, ScoredStudy)
  scoring.ts             reference implementation of the SCORING.md algorithm — framework-free,
                          imports unchanged into both Server and Client Components
  utils.ts                shadcn/ui's `cn()` class-merging helper
prototype/
  net-value-model.html   working single-file prototype (ranks seed data live, tunable knobs)
```

## Ground rule for data (learned the hard way)

Study sites run heavy caching (W3 Total Cache etc.) and JS-render their listings. **A plain fetch
returns a stale/partial list.** Pull via headless browser (Playwright) with a **cache-buster query
param** (`?nocache=<ts>`) and extract the DOM. Individual study detail pages are usually current via
normal fetch. `pay` is always "up to" — reconfirm on the screening call, which is also where you get
the **payout schedule** (rarely published online). See `docs/DATA-SOURCES.md`.

## Support this project

Free and open source, always. A few ways to help — or just say hi:

- **Use it, star it, file an issue.** Honestly the best support an open-source project can get. → [this project](https://tools.mdostal.com/study-tracker)
- **Hire me.** I do fractional-CTO and consulting work — fixing and scaling tech stacks. → [mdostal.com/contact](https://mdostal.com/contact)
- **[Buy me a coffee](https://www.buymeacoffee.com/mdostal)** if it saved you time.
- **More tools like this** → [tools.mdostal.com](https://tools.mdostal.com)
- **Life outside the terminal** → [life.mdostal.com](https://life.mdostal.com)
- **What we're building at Firefly Events** — event discovery, 8,000+ events/day from 7+ sources → [ff.events](https://ff.events)

Always up for a conversation if any of it's useful to you.
