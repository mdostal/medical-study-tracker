# Scoring & weighting algorithm

This is the core of the tool. Everything else is plumbing. The reference implementation lives in
`lib/scoring.ts`; this doc is the spec it must match.

The engine takes a set of studies + a set of **user assumptions** (base city, nanny rate, travel
costs, friend map, and dimension weights) and returns each study scored + ranked, with an eligibility
gate and a childcare-feasibility gate applied.

---

## 0. Eligibility gate (hard filter — runs first)

A study is `eligible_for_him = false` (excluded from ranking, shown in a separate "doesn't apply"
list) if ANY of:

- `sex` is `female` (female-only study)
- `special_pop` is set (e.g. `overweight` / `obese` — requires BMI ≥ 27) — he is lean, BMI ~22.5
- his BMI (22.5) is outside `[bmi_min, bmi_max]` when those are known
- his age is outside `[age_min, age_max]` (⚠ verify his exact age against any `age_max ≤ 40` study)
- `smoker` requirement is `smoker-only`

If BMI is `null` (portal didn't publish it), do NOT exclude — mark `bmi_unconfirmed = true` and rank
it, flagged "confirm BMI on call." Most healthy-volunteer floors are 18–18.5; he clears them.

---

## 1. User assumptions (tunable inputs)

| Input | Default | Meaning |
|---|---|---|
| `home_base` | `austin` | `austin` (now) or `omaha` (after move). Sets drive-vs-fly per city. |
| `nanny_rate` | `200` | $/night for a hired nanny/house-sitter on stays no friend can cover |
| `flight_cost` | `350` | round-trip airfare per trip to a non-drivable city |
| `drive_cost` | `70` | round-trip gas per trip to a drivable city (< ~4 hr) |
| `friend_threshold_nights` | `3` | a stay ≤ this many nights is coverable by a local friend for ~free even without a dedicated childcare friend in that city |
| `max_away_nights` | `31` | he'll do up to ~a month away IF a nanny house-sit makes financial sense; longer single stays get a hard feasibility penalty |
| `w_net` | `0.35` | weight on raw net cash kept |
| `w_velocity` | `0.45` | weight on cash speed (HIGH now — bridge cash is urgent) |
| `w_downtime` | `0.20` | weight on life-downtime efficiency |
| `fx_cad_usd` | `0.73` | CAD→USD, to compare Canadian studies in one currency |

Weights are normalized to sum to 1 before use.

---

## 2. Per-study derived quantities

Let `stays = confinement_stays` (array of night-counts), `visits = followups.visits +
followups.phone_calls_counting_as_trips` (phone calls usually 0 travel — see note).

**Normalize currency:** `pay = pay_gross × (currency === 'CAD' ? fx_cad_usd : 1)`.

**Nights & trips**
```
inpatient_nights = sum(stays)
trips            = stays.length + visits           // each stay and each in-person visit is a journey
```

**Childcare cost** — per stay, decide who covers it:
```
for each stay of n nights:
   if city has a childcare-friend (friend_map[city].can_take_riley === true)  -> cost 0   (friend)
   else if n <= friend_threshold_nights                                          -> cost 0   (short, a friend flies/covers)
   else                                                                          -> cost n * nanny_rate   (nanny house-sit)
childcare_cost = sum of the above
```
Rationale (owner's own words): friends *outside Austin, especially those with kids,* are more likely
to take Riley; short stays a friend can cover; long stays are fundable by a hired nanny house-sit
**if the study makes it make sense** — which is exactly what net + velocity decide.

**Travel cost**
```
drivable      = friend_map.drivable_from(home_base, city)   // < ~4 hr
per_trip      = drivable ? drive_cost : flight_cost
travel_cost   = trips * per_trip
```

**Payout timeline (the new dimension)** — when he actually has ALL the cash:
```
settle_days = payout.settle_days
              // if unknown, estimate conservatively (worst case = paid at the very end):
              // settle_days ≈ last_stay_offset_days + followups.window_weeks*7
              // flag payout_unconfirmed = true
```
`payout.type`:
- `lump_end` — one payment after the last visit
- `prorated` — paid per stay/visit as you go (best for cash flow; lowers effective settle_days —
  use the *weighted-average* day cash is received)
- `milestone` — chunks at defined points
- `unknown` — estimate + flag

**Total downtime (calendar life committed)**
```
downtime_days = inpatient_nights + (followups.window_weeks * 7 discounted)
              // follow-up visit days aren't full lost days; weight the tail at ~0.15/day:
downtime_days = inpatient_nights + followups.window_weeks*7*0.15
```

---

## 3. The three headline metrics

```
net_cash      = pay - travel_cost - childcare_cost           // what he keeps
cash_velocity = net_cash / max(settle_days, 1) * 30          // net $ per 30 days until paid  ← the $30k-6mo vs $15k-1mo judge
downtime_rate = net_cash / max(downtime_days, 1)             // net $ per day of life committed
eff_per_night = net_cash / max(inpatient_nights, 1)          // net $ per inpatient night (secondary)
```

`cash_velocity` is the one that answers his exact question: a $30k paying at 6 months has velocity
`30000/180*30 = $5,000/mo`; a $15k paying at 1 month has velocity `15000/30*30 = $15,000/mo` — the
smaller-faster study wins on velocity, and if bridge cash is the goal, that's correct.

---

## 4. Feasibility gate (childcare reality → multiplier)

```
max_stay = max(stays)
if any stay's city has a childcare-friend OR max_stay <= friend_threshold_nights:
    feasibility = 'EASY'      ; mult = 1.00
else if max_stay <= max_away_nights AND (net_cash after nanny) > 0 comfortably:
    feasibility = 'MODERATE'  ; mult = 0.85    // nanny house-sit, funded by payout, "makes sense"
else if max_stay <= max_away_nights:
    feasibility = 'HARD'      ; mult = 0.60    // doable but the nanny eats most of the gain
else:
    feasibility = 'BLOCKED'   ; mult = 0.00    // single stay longer than he can be away
```

---

## 5. Composite score (0–100)

Normalize each headline metric across the **eligible** set (min–max to 0..1): `n_net`, `n_vel`,
`n_dt`. Then:

```
raw   = w_net * n_net + w_velocity * n_vel + w_downtime * n_dt
score = round(100 * raw * feasibility_mult)
```

Default sort = `score` desc. UX also offers direct sorts by `net_cash`, `cash_velocity`,
`downtime_rate`, and `pay_gross` (see REQUIREMENTS). Ties broken by `cash_velocity`.

---

## 6. What the tool must surface, per study

net cash · cash velocity ($/mo-to-payout) · downtime rate ($/day) · gross · currency · payout type +
settle days (flagged if unconfirmed) · inpatient nights · trips (drive/fly) · travel cost · childcare
cost + who covers · feasibility · eligibility flags (BMI/age/sex/smoker + "confirm" flags) · apply URL
· phone · status.

## 7. Worked example (seed data, austin base, defaults)

- ICON `0021-1389` — $22,000, SLC, stays 5+3+3+3+3, 2 visits, **SLC childcare-friend = yes** → childcare $0,
  travel 7 flights. Strong net, but 5 trips. Velocity depends on payout (unconfirmed → conservative).
- Spaulding `Solar` — $6,625, West Bend **WI (childcare-friend = yes)**, 4 nights, 1 call → childcare $0,
  1 trip. Tiny downtime → **very high downtime_rate and velocity if paid promptly.** A small-fast winner.
- Altasciences KC `N47` — $6,800, Overland Park KS, ~8 nights, 4 visits, **drivable from Omaha** → if
  `home_base=omaha`, travel collapses to ~$350 total and it leaps up the board.

The point: the ranking is *supposed* to change when he flips base or a friend confirms a city. That's
the tool doing its job.
