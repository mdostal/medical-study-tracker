# Application & Chase Tracking — Requirements

The engine ranks studies by net value (`SCORING.md`). But *landing* a study is an **operational
funnel**, not a ranking — apply → chase → screen → enroll → paid. This doc specs the tracking layer so
the tool manages the funnel, closes the loop back into the ranking, and surfaces exactly what to do
next. Proven manually on the real run (see the chase-list the owner used); this is that, productized.

## Core truths this layer encodes
- **Applying ≠ getting in. The chaser gets the slot.** Cohorts fill fast; passive waiting loses seats.
  The tool must push *next actions*, not just store applications.
- **Channel matters.** Some studies you **self-book** a screening (ICON's scheduler, no waiting); some
  you **call to push**; some are **apply-forms** (Fillout) or **syndicated/external** (apply on another
  site). Each has a different chase + confirmation path.
- **The no-email-confirmation gap is real.** Fillout and syndicated apps send **no confirmation email**,
  so there's no automatic record of what was submitted (same problem the fractional-jobs tracker hit).
  The tool must let the user mark "applied" manually and track whether it's *confirmed in their system*.
- **Recruiting runs business hours.** Phone-screens/scheduling are ~8–5 Mon–Fri local time; the tool
  should know when a clinic is *callable now*. (The study *stays* run any days incl. weekends — separate.)

## Lifecycle / status pipeline (per study, per user)
```
identified → applied|booked → phone-screen → screening-scheduled → screened
          → qualified/offered → enrolled → dosing → PAID
   (terminal off-ramps at any point: not-eligible · declined · cohort-full · closed)
```
Plus a **chase sub-state**: `next-action-on-me` · `waiting-on-them` · `stale (no reply N days)` · `done`.

## Data model — new `Application` record (one per user×study)
```ts
interface Application {
  study_id: string;
  channel: 'self_book' | 'call' | 'apply_form_fillout' | 'syndicated_external';
  status: LifecycleStatus;            // the pipeline above
  chase_state: 'on_me' | 'waiting' | 'stale' | 'done';
  applied_date?: string;
  confirmation: { has_number: boolean; confirmed_in_system: boolean; no_email_flag: boolean; ref?: string };
  contact: { phone?: string; scheduler_url?: string; tz?: string };  // tz → business-hours calc
  next_action?: string;               // "self-book screening" | "call to push" | "await cohort dates"
  next_action_due?: string;           // cohort deadline / follow-up-by date → drives nudges
  urgency?: 'now' | 'this_week' | 'normal';   // time-sensitive cohorts flagged
  call_log: CallEntry[];
  // captured on the screening call — these WRITE BACK into the Study + engine:
  screening_date?: string;
  cohort_dates?: string[];
  confirmed: { nights?: number[]; visits?: number; bmi_ok?: boolean };
  payout?: { type: PayoutType; settle_days: number | null };   // ← feeds cash_velocity
  washout_days?: number | null;                                 // ← feeds the stack planner
  stipend_per_visit?: number | null;
  notes?: string;
}
interface CallEntry { date: string; who: string; summary: string; }
```

## Call-log capture — the 5 questions → write-back (the important part)
When the user calls or screens, capture the answers and **write them back onto the Study**, which
sharpens the ranking with real data (closes the `payout timing unknown` / `nights unknown` flags in the
seed):
1. **Exact nights + how many separate stays** → `confirmed.nights` → engine `stays`
2. **How & when do you pay** (lump vs per-visit; end-of-confinement vs after-last-visit; days-to-hit)
   → `payout.type` + `payout.settle_days` → **cash_velocity**
3. **Washout** (days after last dose before dosing again) → `washout_days` → **stack planner**
4. **BMI range fits** → `confirmed.bmi_ok` · **travel/lodging stipend** → `stipend_per_visit`
This is the loop: **rank → apply → chase → capture → re-rank.** Every call makes the tool smarter.

## Chase workflow & nudges
- **"Do today" queue:** studies where `chase_state = on_me` AND the clinic is *callable now* (business
  hours in its tz), sorted urgency-first.
- **Self-book first:** for `channel = self_book`, the action is a direct scheduler link, no waiting.
- **Cohort-deadline alerts:** `urgency = now` + `next_action_due` → surface loudly (e.g., the Aug 10/17
  admit cohorts). Missing a cohort window = losing the slot.
- **Follow-up cadence:** if `waiting` and no movement in N days → flip to `stale`, prompt a re-call.
- **Confirmation recovery:** for Fillout/syndicated apps with no email, offer a browser-history mine
  (same pattern as `command-center/job-hunt/mine-fractional-apps.sh`) to recover which forms were
  actually opened/submitted; otherwise the user hand-marks `applied` at submit-time. Shipped as
  `scripts/mine-study-applications.sh` — a standalone local script the visitor runs on their own
  machine (never a web-app feature; a browser tab has no API to read another app's local browser
  history). The Chase/Pipeline view and the call-log form should surface a short note pointing to
  this script whenever a `apply_form_fillout`/`syndicated_external` application has
  `confirmation.no_email_flag` set and isn't yet `confirmed_in_system`, e.g. "No confirmation email
  for this one — run `scripts/mine-study-applications.sh` locally to check your browser history"
  — rather than attempting to run it in-browser.

## UI
- **Pipeline / Chase view** — list or kanban by lifecycle status; each row shows next-action, a
  **tap-to-call** (`tel:`) button, urgency + business-hours-callable indicators, and a one-tap status
  cycle. Mirrors the working chase-list prototype (localStorage status cycling).
- Lives alongside the ranked **net-value table** (same studies, two lenses: *should I?* vs *where is it?*).
- Per-study drawer: the call log + the captured nights/payout/washout that fed the engine.

## Persistence
- Prototype / single-user: `localStorage` (status + call-log), same as the chase-list prototype.
- Phase 2 multi-user: Supabase rows (per user×study), RLS. No account needed for v1 (see REQUIREMENTS §Phase 2).

## Ties to the rest of the tool
- **SCORING.md** ranks; **this** operationalizes. The call-log write-back is what turns the seed's
  conservative payout/nights *estimates* into confirmed values, so the ranking stops being provisional.
- **DATA-INTEGRITY.md** still applies: a study only shows in the chase pipeline with a real verified
  source_url; captured call data is `verified_by: phone-confirmed`.
- **The stack planner** (REQUIREMENTS §8) consumes `washout_days` captured here to sequence dosings.
