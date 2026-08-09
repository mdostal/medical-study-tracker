import { describe, expect, it } from "vitest";
import {
  deriveAltasciencesCode,
  looksLikeFortreaListingOrHome,
  nightsBetweenMonthDay,
  parseAltasciencesStaysVisits,
} from "../../scripts/pull-studies.mjs";
import {
  digitsOnly,
  extractJalrPayoutTiming,
  parseJalrClinicDetail,
} from "../../scripts/discover-networks.mjs";

// story: fix-study-deep-links -- study 783120's Fortrea link was reported "malformed"
// ("https://www.fortreaclinicaltrials.com/120"). Live-verified 2026-08-09: that URL actually DOES
// resolve to the study's own page (id + pay both present in its own rendered text) -- the real fix
// is that pull-studies.mjs no longer blindly trusts ANY resolved href; it only ships a
// non-canonical-shaped one after cross-checking its own content, and never ships a URL that
// resolves to the bare domain root or back to the listing page itself (the two shapes that would
// actually reproduce "landed on the network homepage"). These tests exercise the classifier that
// decision is built on.
describe("looksLikeFortreaListingOrHome", () => {
  it("flags the bare domain root", () => {
    expect(looksLikeFortreaListingOrHome("https://www.fortreaclinicaltrials.com")).toBe(true);
    expect(looksLikeFortreaListingOrHome("https://www.fortreaclinicaltrials.com/")).toBe(true);
  });

  it("flags the listing page itself", () => {
    expect(
      looksLikeFortreaListingOrHome(
        "https://www.fortreaclinicaltrials.com/en-us/clinical-research/browse-studies"
      )
    ).toBe(true);
  });

  it("does not flag a real study URL, canonical or not", () => {
    expect(
      looksLikeFortreaListingOrHome(
        "https://www.fortreaclinicaltrials.com/en-us/clinical-research/781236-clinical-research-study-adults-glp-1-medication"
      )
    ).toBe(false);
    // study 783120's own real, live-verified (non-canonical-shaped) URL
    expect(looksLikeFortreaListingOrHome("https://www.fortreaclinicaltrials.com/120")).toBe(false);
  });
});

// story: fix-study-deep-links -- Altasciences KC/MTL share one "Ajax Study Detail" module; its own
// heading text takes two different shapes depending on the site (confirmed live 2026-08-09), and
// this tool's pre-existing id convention for this site (already in data/studies.seed.json before
// this puller existed) needs both handled the same way a human curator did by hand.
describe("deriveAltasciencesCode", () => {
  it("derives KC's code from a descriptive title with TWO group codes", () => {
    expect(deriveAltasciencesCode("Healthy Participants (S51) (B2a)")).toBe("S51-B2a");
    expect(deriveAltasciencesCode("Healthy Participants (N47) (G1b)")).toBe("N47-G1b");
  });

  it("derives MTL's code from a leading study number plus ONE group code", () => {
    expect(deriveAltasciencesCode("4727-01 (A1b)")).toBe("4727-01 A1b");
    expect(deriveAltasciencesCode("2612-06 (A17)")).toBe("2612-06 A17");
  });

  it("falls back to the raw heading when neither shape is recognized", () => {
    expect(deriveAltasciencesCode("Some Unparsed Heading")).toBe("Some Unparsed Heading");
  });
});

describe("parseAltasciencesStaysVisits", () => {
  it("parses KC's 'N day/M-night stay' + outpatient-visits prose (single stay)", () => {
    const text =
      "Available for:\n- 1 screening visit\n- 9 day/8-night stay\n- 2 outpatient visits\n" +
      "You May Receive:\n• Compensation up to $6,500";
    expect(parseAltasciencesStaysVisits(text)).toEqual({ stays: [8], visits: 2 });
  });

  it("parses LA's '<count> <n>-night stay(s)' + outpatient-visits prose, expanding a count word", () => {
    const text = "Able to attend 1 screening visit, two 8-night stays, and 25 outpatient visits";
    expect(parseAltasciencesStaysVisits(text)).toEqual({ stays: [8, 8], visits: 25 });
  });

  it("parses LA's single-stay 'a <n>-night stay' phrasing", () => {
    const text = "Able to attend 1 screening visit, a 35-night stay, and 1 outpatient visit";
    expect(parseAltasciencesStaysVisits(text)).toEqual({ stays: [35], visits: 1 });
  });

  it("falls back to MTL's dated 'Clinic stay' + 'Return visits' block when no night-count prose exists", () => {
    const text =
      "Clinic stay\n\n31 Aug (17:30) to 5 Sep (09:00)\n\nReturn visits\n\n8 Sep (08:00)\n15 Sep (08:00)\n" +
      "22 Sep (08:00)\n\nParticipants must be available to stay at our clinic for all of the dates listed above";
    expect(parseAltasciencesStaysVisits(text)).toEqual({ stays: [5], visits: 3 });
  });

  it("returns all-null when neither phrasing is present (never guesses)", () => {
    expect(parseAltasciencesStaysVisits("No stay information published here.")).toEqual({
      stays: null,
      visits: null,
    });
    expect(parseAltasciencesStaysVisits("")).toEqual({ stays: null, visits: null });
  });
});

describe("nightsBetweenMonthDay", () => {
  it("computes nights between two same-year month/day dates", () => {
    expect(nightsBetweenMonthDay("31", "Aug", "5", "Sep")).toBe(5);
  });

  it("rolls over into next year when the end month precedes the start month", () => {
    expect(nightsBetweenMonthDay("30", "Dec", "3", "Jan")).toBe(4);
  });

  it("returns null for an unrecognized month name rather than guessing", () => {
    expect(nightsBetweenMonthDay("1", "Xyz", "5", "Sep")).toBeNull();
  });
});

// story: fix-study-deep-links -- jalr.org's own per-clinic detail pages (e.g.
// jalr.org/full/az_celerion_tempe.html) publish real facts beyond bare clinic names (a phone
// number, a "Payment:" line describing payout timing) that scripts/discover-networks.mjs's JALR
// pass now diffs against data/networks.json -- live-verified 2026-08-09 against Celerion-Tempe's
// and Fortrea-Madison's own pages.
describe("parseJalrClinicDetail", () => {
  it("extracts the Payment field and phone numbers from JALR's own clinic-detail template", () => {
    const text =
      "Current Studies provided by clinic: Type of Clinic: Primarily Healthy volunteer studies " +
      "In-Patient Capacity: 300 Web Links Payment: Checks drawn on Wells Fargo. Pay usually 3 days " +
      "after completion of study. Attire: Unknown Location and Contact Info: 2420 W. Baseline Rd " +
      "Telephone Contact Numbers For Signing Up For A Study: (888) 257-9393 (877) 257-6926 " +
      "Recruiting Hours (MST) Sunday Closed";
    const detail = parseJalrClinicDetail(text);
    expect(detail.payment).toBe("Checks drawn on Wells Fargo. Pay usually 3 days after completion of study.");
    expect(detail.telephoneNumbers).toEqual(["(888) 257-9393", "(877) 257-6926"]);
  });

  it("returns null fields when the page doesn't match JALR's own template (never guesses)", () => {
    const detail = parseJalrClinicDetail("Just some unrelated page text.");
    expect(detail.payment).toBeNull();
    expect(detail.telephoneNumbers).toEqual([]);
  });
});

describe("extractJalrPayoutTiming", () => {
  it("keeps a Payment line that states an explicit day/week unit", () => {
    expect(extractJalrPayoutTiming("Pay usually 3 days after completion of study.")).toBe(
      "Pay usually 3 days after completion of study."
    );
    expect(extractJalrPayoutTiming("Provided within 21 days after end of study.")).toBe(
      "Provided within 21 days after end of study."
    );
  });

  it("drops a Payment line with no stated unit rather than assuming one (Fortrea Madison's own text, missing the word 'days')", () => {
    expect(extractJalrPayoutTiming("Provided within 21 after end of study via check.")).toBeNull();
  });

  it("returns null for empty/missing input", () => {
    expect(extractJalrPayoutTiming(null)).toBeNull();
    expect(extractJalrPayoutTiming("")).toBeNull();
  });
});

describe("digitsOnly", () => {
  it("normalizes phone formats to a comparable bare-digit string, stripping a US country code", () => {
    expect(digitsOnly("(888) 257-9393")).toBe("8882579393");
    expect(digitsOnly("1-888-257-9393")).toBe("8882579393");
    expect(digitsOnly("888-257-9393")).toBe("8882579393");
  });
});
