import { describe, expect, it } from "vitest";
import studiesSeed from "../../data/studies.seed.json";

// Regression test for story dedupe-scraped-studies: scripts/pull-studies.mjs's ICON puller was
// appending the same study card multiple times (Slick carousel clones + the same study rendered
// in more than one carousel section — see scripts/pull-studies.mjs's pullICON comment), producing
// duplicate `id`s in data/studies.seed.json. Duplicate ids break React's `key={s.id}` row identity
// in components/ranked-table.tsx (duplicate-key console warnings) and make counts untrustworthy.
// This guards against a future refresh silently reintroducing duplicate rows.
describe("data/studies.seed.json integrity", () => {
  it("has no duplicate study ids", () => {
    const ids = studiesSeed.studies.map((s) => s.id);
    const uniqueIds = new Set(ids);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates, `duplicate ids found: ${[...new Set(duplicates)].join(", ")}`).toEqual([]);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
