import { describe, expect, it } from "vitest";
import { reconcileNetwork } from "../../scripts/pull-studies.mjs";

// Loose local shape -- reconcileNetwork() lives in a framework-free .mjs puller and works on
// whatever fields a network's own pull produces; these tests only care about id/status/archived_on.
type StudyLike = { id: string; status?: string; archived_on?: string; [key: string]: unknown };

// story: archive-vanished-studies -- scripts/pull-studies.mjs used to replace a network's prior
// studies wholesale with each day's fresh pull, so a study that stopped appearing on the
// network's own site (filled, closed, expired) just vanished from data/studies.seed.json with no
// trace. That broke app/chase/page.tsx for anyone actively tracking it in their own pipeline
// (lib/application-store.ts, joined to this file by study id): the join would come up empty and
// the study's city/pay/phone/source_url would disappear out from under them mid-application.
// reconcileNetwork() is the pure merge step that fixes this -- these tests pin its behavior
// against a fixed clock (no real Date.now() dependency) so they're deterministic.
describe("reconcileNetwork", () => {
  const TODAY = "2026-08-16";

  it("keeps a study present in the fresh pull as-is, ignoring any prior row for the same id", () => {
    const fresh = [{ id: "1", status: "enrolling now", pay_gross: 5000 }];
    const prior = [{ id: "1", status: "enrolling now", pay_gross: 4800 }];
    const { merged, archivedCount, prunedCount } = reconcileNetwork(fresh, prior, TODAY);
    expect(merged).toEqual(fresh);
    expect(archivedCount).toBe(0);
    expect(prunedCount).toBe(0);
  });

  it("archives a prior study that no longer appears in the fresh pull, instead of dropping it", () => {
    const fresh = [{ id: "1", status: "enrolling now" }];
    const prior = [
      { id: "1", status: "enrolling now" },
      { id: "2", status: "enrolling now", city: "Austin" },
    ];
    const { merged, archivedCount, prunedCount } = reconcileNetwork(fresh, prior, TODAY);
    expect(archivedCount).toBe(1);
    expect(prunedCount).toBe(0);
    const archived = merged.find((s) => s.id === "2");
    expect(archived).toMatchObject({ id: "2", city: "Austin", status: "closed", archived_on: TODAY });
  });

  it("carries an already-archived study forward unchanged while still within retention", () => {
    const fresh: StudyLike[] = [];
    const prior = [{ id: "9", status: "closed", archived_on: "2026-07-20" }]; // 27 days before TODAY
    const { merged, archivedCount, prunedCount } = reconcileNetwork(fresh, prior, TODAY);
    expect(merged).toEqual(prior);
    expect(archivedCount).toBe(0);
    expect(prunedCount).toBe(0);
  });

  it("prunes an already-archived study once it's past the 90-day retention window", () => {
    const fresh: StudyLike[] = [];
    const prior = [{ id: "9", status: "closed", archived_on: "2026-04-01" }]; // >90 days before TODAY
    const { merged, archivedCount, prunedCount } = reconcileNetwork(fresh, prior, TODAY);
    expect(merged).toEqual([]);
    expect(archivedCount).toBe(0);
    expect(prunedCount).toBe(1);
  });

  it("prunes a closed row missing archived_on rather than keeping it forever", () => {
    const fresh: StudyLike[] = [];
    const prior = [{ id: "9", status: "closed" }];
    const { merged, prunedCount } = reconcileNetwork(fresh, prior, TODAY);
    expect(merged).toEqual([]);
    expect(prunedCount).toBe(1);
  });

  it("re-opening a study (id reappears in fresh) clears any prior closed/archived_on state", () => {
    const fresh = [{ id: "5", status: "enrolling now" }];
    const prior = [{ id: "5", status: "closed", archived_on: "2026-08-01" }];
    const { merged } = reconcileNetwork(fresh, prior, TODAY);
    expect(merged).toEqual(fresh);
  });
});
