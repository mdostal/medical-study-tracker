# Product requirements — medical-study-tracker

## The user & the job

A generic example user: a lean, healthy, non-smoking adult willing to travel nationally (a national
friend network) to do paid Phase-1 clinical trials. The job: **decide which studies are actually
worth it**, accounting for childcare, travel, payout timing, and downtime — then track the pipeline
(called → screening → enrolled → paid). Later: open it to others as a free public tool. Every real
user's own profile (BMI, base city, etc.) is theirs alone, entered locally and never sent anywhere —
see "Build conventions" / Phase 2 below.

This is the same shape as a **gig-tracker** (job pipeline) — a personal decision+status tool that
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
- **FriendCity** — a city where the user has friends: city, state, `childcare_available`
  (yes/maybe/no), `has_kids`, nearby study hubs, notes. **Anonymized — city + likelihood only, never
  friend names.**
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
   Persist to `localStorage` — no account, no backend row; see "Phase 2 — public" below.
7. **National network directory** — from `networks.json`, with portal links + phones + the call script.
8. **Stack suggester** — best combination of studies to hit a cash target (e.g. "$30k by November"),
   respecting (a) no overlapping confinement windows AND (b) the **washout gap**: no two *drug* studies
   may dose within `washout_days` (standard ~30) of each other. Clinics enforce this across companies via
   shared databases (VCT / CTSdatabase) — so true back-to-back is impossible; the suggester must space
   dosings ≥ washout apart (follow-up visits may overlap the gap). Non-drug studies are exempt.

## Nice-to-have (Phase 1.5+)

- **Calendar view** — plot confinement windows + follow-up tails; detect date collisions between
  stacked studies; overlay the user's own personal-calendar constraints (school pickup, custody
  schedule, work travel, etc. — whatever applies to them).
- **Cash-target planner** — input "$X by date," output the lowest-downtime combination that clears it.
- **Referral inbox** — friends send study referrals; a quick "add study by URL" that pre-fills via
  the live-DOM puller.
- **Auto-refresh** the seed from each network (the pullers in DATA-SOURCES) on a schedule.

## Phase 2 — public

**No accounts, no auth, no backend for v1.** Every visitor's Profile (BMI, base city, weights) and
status-pipeline state persist purely client-side via `localStorage` — zero sign-in, zero server-side
storage, zero third-party auth vendor. Sharing a specific ranking view happens via a link that encodes
the Profile in the URL, not via an account system (an earlier Clerk-based, account-per-user plan was
seriously scoped and then dropped — see `.pHive/epics/public-launch/docs/design-discussion.md` §9 for
the full decision trail). The reasoning: keep the tool as cheap, free, and small as possible — a real
account system isn't needed just to "save your settings" or "share a search."

- **Anonymous by default** — the entire tool works fully client-side; no account of any kind exists.
  The scoring engine (`lib/scoring.ts`) stays pure and framework-free; all persistence is isolated
  behind a thin `lib/profile-store.ts` adapter so the engine never imports browser or framework APIs.
- **Pre-launch sign-up capture (optional, do this EARLY if pursued):** a landing page + waitlist that
  collects emails ahead of full release, so there's an audience the day it opens.
- **Public app ships with a generic example Profile** — any visitor's real inputs live only in their
  own browser's `localStorage`, same as everyone else's. The friend-childcare + payout-timing model is
  the differentiator — no other "find a study" site does net-value ranking.
- **Monetization** — out of scope for v1; not needed given the zero-backend cost structure.

Roadmap sequence: **private (owner, local dev) → public, anonymous, localStorage-only tool.**

## Explicit non-goals

- Not medical advice. Not financial advice. Surface the **harm-liability gap** (trials aren't required
  to cover injury) somewhere honest.
- Don't fabricate payout/BMI data. Unknown = flagged, confirmed on the call.
- Never store or display friends' real names or personal details — city + childcare-likelihood only.

## Build conventions

Next.js 15 App Router · TS · Tailwind · shadcn/ui · no backend, no auth vendor (see Phase 2 above).
Keep `lib/scoring.ts` **pure and framework-free** so it's unit-testable and reusable server- or
client-side. Seed from `data/*.json`.
Mirror `personal-drone` repo conventions.
