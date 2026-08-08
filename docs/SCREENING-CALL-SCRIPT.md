# Screening call script — dial down the list

Pay is always "up to," and **payout timing + exact nights are almost never published online** — the
call is where you get them. Read this off a card; log answers back into the study row.

## Your stats (fill in your own, have them ready)

- Sex, height, weight, BMI, approximate body fat %
- Smoker status / nicotine use
- General health; any condition that's a stated qualifier for a specific study (e.g. documented high
  cholesterol) — mention it only for that study
- Current meds / any weight-loss drugs (GLP-1) in the last 3 months
- Willing to travel; flexible on dates within reason
- (Have your DOB ready for the age-cap studies — e.g. any 18–40 study)

## The five questions that decide it (ask every time)

1. **"What's the exact confinement — how many nights, and how many separate stays?"**
2. **"How many in-person follow-up visits, and over how many weeks?"** (the tail)
3. **"What's the BMI range for this one?"** (confirm your own BMI fits — most floors are 18–18.5)
4. **"How and WHEN do you pay?"** ← the money question, in three parts:
   - Lump sum or paid per stay/visit as I go?
   - Do I get the full amount at the **end of confinement**, or only after the **last follow-up visit**?
   - **How many days/weeks until the money actually hits** (ClinCard, check, direct deposit)?
5. **"Any travel or lodging stipend?"** (Fortrea pays $100/visit — ask everyone)

> A $30k that settles 6 months out is worse bridge cash than a $15k that pays end-of-month. Q4 is how
> you tell them apart. Log the answer as `payout.settle_days` — that drives the cash-velocity ranking.

## Also confirm

- "Am I eligible as a **US citizen** for this site?" (Canada studies — Montreal, Toronto)
- "When's the **next screening slot**, and what does screening involve (bloodwork, fasting)?"
- **"What's the washout period — how long after the last dose before I can dose in another study?"**
  (Standard is ~**30 days**, longer for long-half-life drugs. Clinics enforce it via shared databases —
  **Verified Clinical Trials (VCT) / CTSdatabase** — that flag dual-enrollment across companies, so you
  CANNOT do two drug studies back-to-back. This determines what you can stack. Capture as `washout_days`.)

## Call order (example — from the ranked tool, given your own base city and profile)

Work top-down by score. Example shortlist format, illustrating the pattern:
1. **[Network] — [in-city] (phone)** — zero travel, high pay. Call first.
2. **[Network] — [city]** — largest single payout; confirm nights/confinement length before committing.
3. **[Network] — [drivable city] (phone)** — short stay, short drive → high velocity.
4. **[Network] — [city, study id]** — already applying; confirm any friend/childcare coverage you've
   arranged for this city.
5. **[Network] — [city]** — short stay, travel stipend offered.
6. **[Network] — [city] (phone)** — long visit tail; ask whether stays can be bundled.
7. **[Network] — [city, study id]** — only relevant if you meet a stated special-population qualifier
   (e.g. documented high cholesterol); drivable from an alternate base if applicable.

Log each: called → screening → enrolled, plus the 5 answers.
