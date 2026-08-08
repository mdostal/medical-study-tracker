# CLAUDE.md — medical-study-tracker

## What this is

A public decision-engine tool: ranks paid Phase-1 / healthy-volunteer clinical trial studies by
**net cash kept, cash velocity, and downtime** — not by headline "up to $" pay. Ships as a public,
free tool linked from the owner's site under `/tools`. Repo is public. See `README.md` and
`docs/REQUIREMENTS.md` for product shape, `docs/SCORING.md` for the algorithm.

## Critical rule: NO PII in this repo, ever

This repo is public. Earlier drafts hard-coded the owner's personal circumstances (child's first
name, exact biometrics, custody status, financial urgency, relocation plans) directly into docs,
`lib/types.ts` field names (e.g. a `can_take_riley` field), and seed data. **That is being
scrubbed.** Going forward:

- Never commit a real person's name (the owner's, a family member's, a friend's) anywhere in the repo.
- Never commit specific biometric/medical details as if they belong to a real person — the shipped
  `Profile` type is generic and user-editable, not hard-coded.
- The friend/childcare-network concept ships as **anonymized example data** (city + generic
  likelihood only) — this was already the stated design intent in the original data file's own
  comment, just not fully honored in field naming and docs prose.
- The owner's own real personal defaults (their BMI, home base, actual friend map) live **locally
  only**, gitignored, under `.local/` (a scripts/config folder, not committed). Never move real
  personal data back into `data/`, `docs/`, or source identifiers.
- Before flipping the GitHub repo public: git history must be scrubbed (history rewrite), not just
  the working tree — the PII is already committed in the first two commits.

## Architecture decisions (superseding older REQUIREMENTS.md language)

- **No accounts, no auth, no backend for v1.** Every visitor's Profile (BMI, base city, weights)
  and status-pipeline state persist purely client-side via `localStorage` — zero sign-in, zero
  server-side storage, zero third-party vendor. Sharing a specific ranking view happens via a link
  that encodes the Profile in the URL, not via an account system. This replaces both the original
  "Supabase auth + RLS, full multi-tenant plugin shell" framing in `docs/REQUIREMENTS.md` AND an
  earlier (superseded) Clerk-based plan — the reasoning: keep the tool as cheap, free, and
  miniscule as possible; a real account system isn't needed just to "save your settings" or "share
  a search." See `.pHive/epics/public-launch/docs/design-discussion.md` §9 for the full decision
  trail (Clerk was seriously scoped, then dropped in favor of this).
- **Owner's personal defaults are local-only.** A gitignored `.local/` folder holds the owner's own
  assumptions/profile for their own dev-time use. The public app ships with a generic example
  profile; any visitor's real inputs live only in their own browser's `localStorage`, same as
  everyone else's.
- Engine (`lib/scoring.ts`) stays pure and framework-free per the existing convention. All
  persistence (currently `localStorage`) is isolated behind a thin `lib/profile-store.ts` adapter
  so the engine never imports browser or framework APIs.

## Build commands (intended — app not yet scaffolded)

Declared in `package.json` but dependencies are not yet installed / Next.js project not yet
scaffolded:
- `npm run dev` → `next dev`
- `npm run build` → `next build`
- `npm run test` → `vitest run`
- `npm run lint` → `next lint`

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · shadcn/ui · lightweight auth/profile (TBD:
Clerk or equivalent) for saved searches. No heavy backend multi-tenant system planned for v1.

## Key docs

- `docs/REQUIREMENTS.md` — product spec (note the superseded auth section above)
- `docs/SCORING.md` — the ranking algorithm, authoritative spec for `lib/scoring.ts`
- `docs/DATA-SOURCES.md` — how seed data is refreshed from CRO/network sites
- `docs/SCREENING-CALL-SCRIPT.md` — currently owner-specific; needs genericizing in the PII scrub
- `prototype/net-value-model.html` — working single-file reference prototype
