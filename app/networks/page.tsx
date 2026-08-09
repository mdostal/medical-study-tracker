import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "@/lib/utils";
import networksData from "@/data/networks.json";

// REQUIREMENTS.md must-have #7: national network directory, rendered
// directly from data/networks.json (never hand-copied — see this story's
// risk register: hand-typed directory content would drift from the JSON
// as docs/DATA-SOURCES.md refreshes land).

export const metadata: Metadata = {
  title: "Network directory — Medical Study Tracker",
  description:
    "Every paid Phase-1 / healthy-volunteer CRO network, its sites, portal links, and phone numbers, straight from data/networks.json.",
};

interface NetworkSite {
  city: string;
  state: string;
  country: string;
  hub?: string;
  phone?: string;
  portal?: string;
  phase?: string;
}

interface Network {
  name: string;
  brand?: string;
  sites: NetworkSite[];
  portal: string;
  phone: string;
  notes?: string;
  status?: string;
  verified?: string;
}

// story: directory-gap-discovery -- scripts/discover-networks.mjs crawls jalr.org's clinic
// directory and diffs it against the confirmed `networks` array above, writing anything not
// already covered into this separate `discovered_networks` array. Deliberately a distinct shape
// from Network (no portal/phone/pay -- per docs/DATA-INTEGRITY.md, nothing here is fabricated;
// it's a name, a location, and a link to go check yourself).
interface DiscoveredSite {
  city: string;
  state: string;
  country?: string;
}

interface DiscoveredNetwork {
  name: string;
  status: string;
  sites: DiscoveredSite[];
  source_url: string;
  discovered: string;
  note?: string;
}

const NETWORKS = (networksData as unknown as { networks: Network[] }).networks;
const DISCOVERED_NETWORKS =
  (networksData as unknown as { discovered_networks?: DiscoveredNetwork[] })
    .discovered_networks ?? [];

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function isPhoneish(value: string): boolean {
  return /\d{3}.*\d{4}/.test(value);
}

function telHref(value: string): string {
  return `tel:${value.replace(/[^\d+]/g, "")}`;
}

function PortalLink({ value }: { value: string | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  if (isHttpUrl(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-accent-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
      >
        {value.replace(/^https?:\/\//, "")}
      </a>
    );
  }
  const emailMatch = value.match(/[^\s]+@[^\s]+\.[^\s]+/);
  if (emailMatch) {
    return (
      <a
        href={`mailto:${emailMatch[0]}`}
        className="underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
      >
        {value}
      </a>
    );
  }
  return <span className="text-muted-foreground">{value}</span>;
}

function PhoneLink({ value }: { value: string | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  if (isPhoneish(value)) {
    return (
      <a
        href={telHref(value)}
        className="font-mono tabular-nums underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
      >
        {value}
      </a>
    );
  }
  return <span className="font-mono text-muted-foreground">{value}</span>;
}

function NetworkCard({ network }: { network: Network }) {
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            {network.name}
            {network.brand && (
              <span className="ml-2 font-mono text-[0.68rem] font-normal text-muted-foreground">
                {network.brand}
              </span>
            )}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {network.status === "verify" && (
            <span className="rounded border border-amber-600/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-wide text-amber-700 dark:text-amber-400">
              verify
            </span>
          )}
          {network.verified && network.verified !== "pending" && (
            <span className="font-mono text-[0.62rem] text-muted-foreground">
              verified {network.verified}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-1 font-mono text-[0.72rem] sm:grid-cols-2">
        <div>
          <span className="text-muted-foreground">portal </span>
          <PortalLink value={network.portal} />
        </div>
        <div>
          <span className="text-muted-foreground">phone </span>
          <PhoneLink value={network.phone} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[480px] text-left text-[0.74rem]">
          <thead>
            <tr className="border-b bg-muted/40 font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">Site</th>
              <th className="px-3 py-1.5 font-medium">Hub</th>
              <th className="px-3 py-1.5 font-medium">Portal</th>
              <th className="px-3 py-1.5 font-medium">Phone</th>
            </tr>
          </thead>
          <tbody>
            {network.sites.map((site, i) => (
              <tr key={`${network.name}-${i}`} className="border-b last:border-0">
                <td className="px-3 py-1.5">
                  {site.city}, {site.state}
                  {site.country && site.country !== "US" ? ` (${site.country})` : ""}
                  {site.phase && (
                    <div className="font-mono text-[0.62rem] text-muted-foreground">
                      {site.phase}
                    </div>
                  )}
                </td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">
                  {site.hub ?? "—"}
                </td>
                <td className="px-3 py-1.5 font-mono">
                  <PortalLink value={site.portal ?? network.portal} />
                </td>
                <td className="px-3 py-1.5 font-mono">
                  <PhoneLink value={site.phone ?? network.phone} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {network.notes && (
        <p className="text-[0.78rem] text-muted-foreground">{network.notes}</p>
      )}
    </div>
  );
}

// story: directory-gap-discovery -- deliberately a visually distinct, dimmed card: no portal/
// phone columns (there isn't any confirmed data to show), one badge that's impossible to confuse
// with the "verify" badge above (different label, different color), and the JALR/source link is
// the ONLY link -- there's nothing else about a discovered entry that's been checked yet.
function DiscoveredNetworkCard({ network }: { network: DiscoveredNetwork }) {
  return (
    <div className="space-y-2 rounded-xl border border-dashed bg-muted/20 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium text-muted-foreground">{network.name}</h3>
        <span className="rounded border border-sky-600/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-wide text-sky-700 dark:text-sky-400">
          discovered — not yet verified
        </span>
      </div>
      <p className="font-mono text-[0.72rem] text-muted-foreground">
        {network.sites
          .map((s) => `${s.city}, ${s.state}${s.country && s.country !== "US" ? ` (${s.country})` : ""}`)
          .join(" · ")}
      </p>
      <p className="text-[0.74rem] text-muted-foreground">
        Found via{" "}
        <a
          href={network.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          jalr.org listing
        </a>{" "}
        ({network.discovered}). No pay, eligibility, or study data exists for this entry yet —
        confirm directly before relying on it.
      </p>
    </div>
  );
}

// --- Call-script embed -----------------------------------------------------
// docs/SCREENING-CALL-SCRIPT.md is genericized reference content (per
// scrub-working-tree-pii), read at render time and rendered inline (no
// external link dependency, no markdown package added — a small line-based
// renderer is enough for this file's fixed, trusted structure: headings,
// bullet/numbered lists, blockquotes, **bold**, and `code`).

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={`${keyPrefix}-b${i}`}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code
          key={`${keyPrefix}-c${i}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = match.index + token.length;
    i++;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function renderCallScript(md: string): React.ReactNode[] {
  const lines = md.split("\n");
  const blocks: React.ReactNode[] = [];
  let paraBuffer: string[] = [];
  let listBuffer: { type: "ul" | "ol"; items: string[] } | null = null;
  let key = 0;

  function flushPara() {
    if (paraBuffer.length === 0) return;
    const text = paraBuffer.join(" ");
    blocks.push(
      <p key={`p-${key++}`} className="text-sm leading-relaxed text-foreground/90">
        {renderInline(text, `p-${key}`)}
      </p>
    );
    paraBuffer = [];
  }

  function flushList() {
    if (!listBuffer) return;
    const { type, items } = listBuffer;
    blocks.push(
      type === "ol" ? (
        <ol key={`ol-${key++}`} className="ml-5 list-decimal space-y-1 text-sm">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `oli-${key}-${idx}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={`ul-${key++}`} className="ml-5 list-disc space-y-1 text-sm">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `uli-${key}-${idx}`)}</li>
          ))}
        </ul>
      )
    );
    listBuffer = null;
  }

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === "") {
      flushPara();
      continue;
    }
    if (line.startsWith("### ")) {
      flushPara();
      flushList();
      blocks.push(
        <h4 key={`h4-${key++}`} className="pt-2 text-sm font-semibold">
          {renderInline(line.slice(4), `h4-${key}`)}
        </h4>
      );
      continue;
    }
    if (line.startsWith("## ")) {
      flushPara();
      flushList();
      blocks.push(
        <h3 key={`h3-${key++}`} className="pt-3 text-base font-semibold">
          {renderInline(line.slice(3), `h3-${key}`)}
        </h3>
      );
      continue;
    }
    if (line.startsWith("# ")) {
      flushPara();
      flushList();
      // Skip the doc's own top-level title — this section already has one.
      continue;
    }
    if (line.startsWith("> ")) {
      flushPara();
      flushList();
      blocks.push(
        <blockquote
          key={`bq-${key++}`}
          className="border-l-2 border-emerald-600/40 pl-3 text-sm italic text-muted-foreground"
        >
          {renderInline(line.slice(2), `bq-${key}`)}
        </blockquote>
      );
      continue;
    }
    const bulletMatch = line.match(/^-\s+(.*)/);
    if (bulletMatch) {
      flushPara();
      if (!listBuffer || listBuffer.type !== "ul") {
        flushList();
        listBuffer = { type: "ul", items: [] };
      }
      listBuffer.items.push(bulletMatch[1]);
      continue;
    }
    const numMatch = line.match(/^\d+\.\s+(.*)/);
    if (numMatch) {
      flushPara();
      if (!listBuffer || listBuffer.type !== "ol") {
        flushList();
        listBuffer = { type: "ol", items: [] };
      }
      listBuffer.items.push(numMatch[1]);
      continue;
    }

    flushList();
    paraBuffer.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

function loadCallScript(): string {
  const filePath = path.join(process.cwd(), "docs", "SCREENING-CALL-SCRIPT.md");
  return fs.readFileSync(filePath, "utf-8");
}

export default function NetworksPage() {
  const callScript = loadCallScript();

  return (
    <div className="min-h-screen space-y-8 p-6 pb-20 sm:p-10">
      <header className="mx-auto max-w-[1100px] space-y-2">
        <Link
          href="/"
          className="font-mono text-[0.68rem] text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          &larr; back to the ranked tracker
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          National network directory
        </h1>
        <p className="max-w-[70ch] text-sm text-muted-foreground">
          Every paid Phase-1 / healthy-volunteer CRO network this tool tracks —
          sites, portal links, and phone numbers — rendered straight from{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            data/networks.json
          </code>
          . Pay is always &ldquo;up to&rdquo;; payout timing and exact nights
          are almost never posted online — that&apos;s what the call script
          below is for.
        </p>
      </header>

      <div className={cn("mx-auto grid max-w-[1100px] gap-4")}>
        {NETWORKS.map((network) => (
          <NetworkCard key={network.name} network={network} />
        ))}
      </div>

      {DISCOVERED_NETWORKS.length > 0 && (
        <section className="mx-auto max-w-[1100px] space-y-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold tracking-tight">
              Discovered — not yet verified
            </h2>
            <p className="max-w-[70ch] text-sm text-muted-foreground">
              Found by crawling{" "}
              <a
                href="https://jalr.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
              >
                jalr.org
              </a>
              &apos;s clinic directory and diffing it against the confirmed list above
              (<code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                scripts/discover-networks.mjs
              </code>
              ). These are names and locations only — nobody has called or visited yet, so there
              is no pay, eligibility, or study data for any of them. Treat each one as a lead to
              check, not a listing to trust.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {DISCOVERED_NETWORKS.map((network) => (
              <DiscoveredNetworkCard key={network.name} network={network} />
            ))}
          </div>
        </section>
      )}

      <p className="mx-auto max-w-[1100px] text-sm text-muted-foreground">
        Looking for other places to check, or where the &ldquo;discovered&rdquo; entries above come
        from? See{" "}
        <Link
          href="/resources"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
        >
          Resources
        </Link>
        .
      </p>

      <section className="mx-auto max-w-[1100px] space-y-3 rounded-xl border bg-card p-5">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Screening call script
        </h2>
        <div className="space-y-3">{renderCallScript(callScript)}</div>
      </section>
    </div>
  );
}
