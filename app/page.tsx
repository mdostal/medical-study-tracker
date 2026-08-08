import type { Assumptions, FriendMap, Profile, Study } from "@/lib/types";
import { DEFAULT_ASSUMPTIONS } from "@/lib/types";
import { scoreAll } from "@/lib/scoring";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EligibilityDemo } from "@/components/eligibility-demo";

// Generic example profile — real visitor profiles live only in their own
// browser's localStorage (see design-discussion.md §9). Never hard-code a
// real person's biometrics here.
const DEMO_PROFILE: Profile = {
  bmi: 24,
  weight_lb: 180,
  sex: "male",
  age: 32,
  conditions: [],
};

// Minimal literal FriendMap for this proof-of-wiring page. The shipped
// friend-childcare-map.json's shape has drifted from the FriendMap type
// (tracked separately) so the placeholder builds its own valid instance
// rather than depend on that mismatch.
const DEMO_FRIEND_MAP: FriendMap = {
  hubs: {},
  friend_metros: [],
  base_drive_hubs: { austin: ["SA", "DFW"], omaha: ["LINC", "LEN"] },
  home_base_childcare: {},
};

const assumptions: Assumptions = DEFAULT_ASSUMPTIONS;

// A handful of literal example studies for this scaffold-proof page. The
// real seed data (data/studies.seed.json) has known data-integrity gaps
// tracked separately (docs/DATA-INTEGRITY.md) — this placeholder stays
// self-contained rather than depend on that in-progress cleanup.
const DEMO_STUDIES: Study[] = [
  {
    id: "demo-a", network: "Example Network", city: "San Antonio", state: "TX",
    hub: "SA", pay_gross: 18500, currency: "USD",
    payout: { type: "lump_end", settle_days: 45 },
    stays: [8, 1, 1], visits: 6, bmi_min: 18.5, bmi_max: 30, age_min: 18,
    age_max: 65, sex: "M/F", smoker: "any", special_pop: null,
  },
  {
    id: "demo-b", network: "Example Network", city: "Salt Lake City", state: "UT",
    hub: "SLC", pay_gross: 9500, currency: "USD",
    payout: { type: "prorated", settle_days: 60 },
    stays: [13], visits: 1, bmi_min: null, bmi_max: null, age_min: 18,
    age_max: 55, sex: "M/F", smoker: "non", special_pop: null,
  },
  {
    id: "demo-c", network: "Example Network", city: "Dallas", state: "TX",
    hub: "DFW", pay_gross: 13700, currency: "USD",
    payout: { type: "unknown", settle_days: null },
    stays: [3], visits: 10, bmi_min: 18, bmi_max: 30, age_min: 18,
    age_max: 55, sex: "M/F", smoker: "non", special_pop: null,
  },
  {
    id: "demo-d", network: "Example Network", city: "Overland Park", state: "KS",
    hub: "LEN", pay_gross: 6800, currency: "USD",
    payout: { type: "milestone", settle_days: 90 },
    stays: [8], visits: 4, bmi_min: null, bmi_max: null, age_min: 18,
    age_max: 60, sex: "M/F", smoker: "non", special_pop: null,
  },
  {
    id: "demo-e", network: "Example Network", city: "West Bend", state: "WI",
    hub: "WI", pay_gross: 6625, currency: "USD",
    payout: { type: "lump_end", settle_days: 30 },
    stays: [4], visits: 0, bmi_min: 18, bmi_max: 32, age_min: 18,
    age_max: 55, sex: "M/F", smoker: "non", special_pop: null, min_weight_lb: 110,
  },
];

export default function Home() {
  // Server Component: scoreAll() from lib/scoring.ts runs here, at request
  // time, with zero client-side JS shipped for this computation.
  const { eligible } = scoreAll(DEMO_STUDIES, DEMO_PROFILE, assumptions, DEMO_FRIEND_MAP);
  const top = eligible.slice(0, 5);

  return (
    <div className="min-h-screen p-8 sm:p-16 space-y-8 max-w-4xl mx-auto">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Medical Study Tracker
        </h1>
        <p className="text-muted-foreground text-sm">
          Scaffold check: this page proves <code>lib/scoring.ts</code> and{" "}
          <code>lib/types.ts</code> import cleanly into both a Server
          Component (the ranked table below, computed server-side) and a
          Client Component (the interactive eligibility check further down).
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Top-ranked studies (server-computed)</CardTitle>
          <CardDescription>
            <code>scoreAll()</code> ran in a Server Component against example
            studies and a generic example profile.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Study</TableHead>
                <TableHead>City</TableHead>
                <TableHead className="text-right tabular-nums">
                  Net cash
                </TableHead>
                <TableHead>Feasibility</TableHead>
                <TableHead className="text-right tabular-nums">
                  Score
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.id}</TableCell>
                  <TableCell>{s.city}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    ${s.net_cash.toLocaleString()}
                  </TableCell>
                  <TableCell>{s.feasibility}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.score}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <EligibilityDemo />
    </div>
  );
}
