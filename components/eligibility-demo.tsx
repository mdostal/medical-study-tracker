"use client";

import { useMemo, useState } from "react";
import type { Profile, Study } from "@/lib/types";
import { isEligible } from "@/lib/scoring";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// A single representative study, just for this client-side demo.
const SAMPLE_STUDY: Study = {
  id: "demo-study",
  network: "Example Network",
  city: "Example City",
  state: "TX",
  hub: "SA",
  pay_gross: 10000,
  currency: "USD",
  payout: { type: "unknown", settle_days: null },
  stays: [5],
  visits: 1,
  bmi_min: 18.5,
  bmi_max: 30,
  age_min: 18,
  age_max: 55,
  sex: "M/F",
  smoker: "non",
  special_pop: null,
};

/**
 * Client Component proving lib/types.ts (Profile, Study) and lib/scoring.ts
 * (isEligible) import and run cleanly in the browser — a thin interactive
 * shell over the same framework-free engine the Server Component above uses.
 */
export function EligibilityDemo() {
  const [bmi, setBmi] = useState(24);

  const profile: Profile = useMemo(
    () => ({ bmi, weight_lb: 180, sex: "male", age: 32 }),
    [bmi],
  );

  const result = isEligible(SAMPLE_STUDY, profile);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client-side eligibility check</CardTitle>
        <CardDescription>
          Drag the slider — <code>isEligible()</code> from{" "}
          <code>lib/scoring.ts</code> re-runs in the browser on every change.
          Sample study accepts BMI {SAMPLE_STUDY.bmi_min}–{SAMPLE_STUDY.bmi_max}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-3 text-sm">
          <span className="w-24 shrink-0">BMI: {bmi.toFixed(1)}</span>
          <input
            type="range"
            min={15}
            max={35}
            step={0.5}
            value={bmi}
            onChange={(e) => setBmi(Number(e.target.value))}
            className="w-full"
          />
        </label>
        <p className="text-sm font-medium tabular-nums">
          {result.ok ? "Eligible" : `Not eligible: ${result.reason}`}
        </p>
      </CardContent>
    </Card>
  );
}
