// Same-origin proxy for "add a study by URL" (story: add-study-by-url).
//
// Resolves this story's AC5 constraint: a client-side fetch of a
// cross-origin CRO portal would be blocked by CORS, so the live-DOM pull
// runs server-side, behind this thin Next.js Route Handler, and only the
// pre-filled *fields* (never raw scraped markup) go back to the browser.
//
// Runs in the Node.js runtime (the default for a Route Handler unless an
// Edge runtime is explicitly opted into — not done here), which is what
// lets this use Node's fetch with a timeout signal. See
// lib/study-extract.ts's file-level comment for why this route uses a plain
// fetch() rather than Playwright (the research finding this story's
// `research` step was scoped to produce).
//
// Security (this story's risk table, "malicious/malformed URL" row):
//   - Only http(s) URLs are ever fetched (isFetchableHttpUrl).
//   - Only known-network hosts (per data/networks.json) are fetched at all —
//     an unrecognized host short-circuits to the manual-entry fallback
//     without ever calling fetch() on it (AC1 + AC2).
//   - The fetched page's HTML is parsed with plain-string regex extraction
//     (lib/study-extract.ts) only — never eval'd, never assigned to
//     innerHTML anywhere (here or client-side); only plain strings/numbers
//     cross back to the browser as JSON.
//   - A short timeout bounds how long a single request can hang.

import { NextResponse } from "next/server";
import networksSeed from "@/data/networks.json";
import {
  cacheBustedUrl,
  extractStudyFields,
  isFetchableHttpUrl,
  isKnownNetworkUrl,
  knownNetworkDomains,
} from "@/lib/study-extract";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 3_000_000; // guard against an oversized/non-HTML response

// data/networks.json's raw text (not the parsed object) is what
// knownNetworkDomains sweeps for URLs — re-stringify the imported JSON once
// at module load rather than re-reading the file, since Next.js already
// bundles the parsed JSON import.
const KNOWN_DOMAINS = knownNetworkDomains(JSON.stringify(networksSeed));

export interface PullStudyResponse {
  ok: boolean;
  knownNetwork: boolean;
  prefill: ReturnType<typeof extractStudyFields> | null;
  sourceUrl: string;
  message?: string;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, knownNetwork: false, prefill: null, sourceUrl: "", message: "Invalid request body." } satisfies PullStudyResponse,
      { status: 400 },
    );
  }

  const url = typeof (body as { url?: unknown })?.url === "string" ? (body as { url: string }).url.trim() : "";

  if (!url || !isFetchableHttpUrl(url)) {
    return NextResponse.json(
      {
        ok: true,
        knownNetwork: false,
        prefill: null,
        sourceUrl: url,
        message: "That doesn't look like a valid http(s) URL — use the manual form below.",
      } satisfies PullStudyResponse,
      { status: 200 },
    );
  }

  // Unknown network: fall back to manual entry per AC2 — this is not an
  // error, it's the expected path for the majority of URLs a visitor might
  // paste (a referral link from a network this app doesn't track yet).
  if (!isKnownNetworkUrl(url, KNOWN_DOMAINS)) {
    return NextResponse.json(
      {
        ok: true,
        knownNetwork: false,
        prefill: null,
        sourceUrl: url,
        message: "Unrecognized network — fill in the details manually below.",
      } satisfies PullStudyResponse,
      { status: 200 },
    );
  }

  try {
    const res = await fetch(cacheBustedUrl(url), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/124.0 Safari/537.36 medical-study-tracker-add-by-url/1.0",
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: true,
          knownNetwork: true,
          prefill: null,
          sourceUrl: url,
          message: `Study page returned ${res.status} — fill in the details manually below.`,
        } satisfies PullStudyResponse,
        { status: 200 },
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) {
      return NextResponse.json(
        {
          ok: true,
          knownNetwork: true,
          prefill: null,
          sourceUrl: url,
          message: "That URL didn't return an HTML page — fill in the details manually below.",
        } satisfies PullStudyResponse,
        { status: 200 },
      );
    }

    const html = (await res.text()).slice(0, MAX_HTML_BYTES);
    const prefill = extractStudyFields(html);

    return NextResponse.json(
      { ok: true, knownNetwork: true, prefill, sourceUrl: url } satisfies PullStudyResponse,
      { status: 200 },
    );
  } catch (err) {
    // Network error, timeout, DNS failure, etc. — never surface a 500 to the
    // visitor for this best-effort pre-fill; always resolve to the manual
    // fallback per AC2.
    const reason = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      {
        ok: true,
        knownNetwork: true,
        prefill: null,
        sourceUrl: url,
        message: `Couldn't reach that page (${reason}) — fill in the details manually below.`,
      } satisfies PullStudyResponse,
      { status: 200 },
    );
  }
}
