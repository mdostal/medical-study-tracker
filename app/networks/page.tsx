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

const NETWORKS = (networksData as unknown as { networks: Network[] }).networks;

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

      <section className="mx-auto max-w-[1100px] space-y-3 rounded-xl border bg-card p-5">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Screening call script
        </h2>
        <div className="space-y-3">{renderCallScript(callScript)}</div>
      </section>
    </div>
  );
}
