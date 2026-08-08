# Product requirements — medical-study-tracker

## The user & the job

A single parent, lean healthy non-smoking male (BMI ~22.5), needs **bridge cash now** and is
willing to travel the country (his friend network is national) to do paid Phase-1 clinical trials.
The job: **decide which studies are actually worth it**, accounting for childcare, travel, payout
timing, and downtime — then track the pipeline (called → screening → enrolled → paid). Later: open it
to others as a free public tool.

This is the same shape as his **gig-tracker** (job pipeline) — a personal decision+status tool that
graduates into a product.

## Core principle

Rank by **net-of-everything and speed-to-cash**, never by the headline "up to $". The scoring engine
(`docs/SCORING.md`) is authoritative. The UI is a thin, tunable shell over it.

## Data model (see `lib/types.ts` for exact types)

- **Study** — one enrolling cohort at one site: id, network, site city/state/country, hub, gross pay +
  currency, **payout {type, settle_days}**, confinement_stays[], followups {visits, phone_calls,
  window_weeks}, eligibility {bmi_min/max, age_min/max, sex, smoker, special_pop}, source_url,
  apply_url, phone, verified date, status, notes.
- **Network** — a CRO and its sites: name, sites[{city, state, country, hub}], portal_url, phone,
  pull_method (how to scrape it live), verified.
- **FriendCity** — a city where he has friends: city, state, `can_take_riley` (yes/maybe/no),
  `has_kids`, nearby study hubs, notes. **Anonymized — city + likelihood only, never friend names.**
- **Assumptions** — the tunable inputs from SCORING §1 (base, nanny rate, travel costs, weights…).
- **ScoredStudy** — a Study + all derived metrics + score + feasibility + flags.

## Must-have features (Phase 1, the hive build)

1. **Ranked table** of eligible studies, sorted by composite score, columns per SCORING §6.
2. **Tunable assumptions panel** — home-base toggle (Austin/Omaha), nanny rate, flight/drive cost,
   friend-threshold nights, and the three weight sliders (net / velocity / downtime). Re-ranks live.
   (The prototype already does all of this — port its behavior.)
3. **Payout-timing model** — first-class. Show payout type + settle-days; when unknown, show the
   conservative estimate with a "confirm on call" flag. Cash-velocity column is the headline judge.
4. **Childcare-by-friend-city** — pull from FriendCity map. A study in a friend-city shows "friend
   covers"; elsewhere shows the nanny cost that got subtracted. Editable per city (yes/maybe/no).
5. **Eligibility gate** — separate "you qualify" vs "doesn't apply (why)" lists. Never bury the gate.
6. **Status pipeline** — per study: not-started → called → screening → enrolled → done → not-eligible.
   Persist (localStorage in prototype; Supabase row in the app).
7. **National network directory** — from `networks.json`, with portal links + phones + the call script.
8. **Stack suggester** — best combination of studies to hit a cash target (e.g. "$30k by November"),
   respecting that two studies can't have overlapping confinement windows.

## Nice-to-have (Phase 1.5+)

- **Calendar view** — plot confinement windows + follow-up tails; detect date collisions between
  stacked studies; overlay Riley's school/custody calendar.
- **Cash-target planner** — input "$X by date," output the lowest-downtime combination that clears it.
- **Referral inbox** — his friends send study referrals; a quick "add study by URL" that pre-fills via
  the live-DOM puller.
- **Auto-refresh** the seed from each network (the pullers in DATA-SOURCES) on a schedule.

## Phase 2 — public tool (gated on his cash need being met)

- Multi-user (Supabase auth + RLS). Each user sets their own profile (BMI, sex, base city, friend map)
  and the same engine ranks for them.
- Public network directory + "is this study worth it for me" calculator.
- **Not shared publicly until the owner says go.** Build private-first.

## Explicit non-goals

- Not medical advice. Not financial advice. Surface the **harm-liability gap** (trials aren't required
  to cover injury) somewhere honest.
- Don't fabricate payout/BMI data. Unknown = flagged, confirmed on the call.
- Never store or display friends' real names or personal details — city + childcare-likelihood only.

## Build conventions

Next.js 15 App Router · TS · Tailwind · shadcn/ui · Supabase. Keep `lib/scoring.ts` **pure and
framework-free** so it's unit-testable and reusable server- or client-side. Seed from `data/*.json`.
Mirror `personal-drone` repo conventions.
