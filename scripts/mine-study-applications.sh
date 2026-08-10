#!/bin/bash
# Fillout/syndicated study applications send NO confirmation email (same gap the
# fractional-jobs tracker hit) -- the apply URL itself, sitting in local browser
# history, is the only record that a form was ever opened/submitted. This mines
# Chrome/Arc's own local History SQLite file for those URLs. Re-run anytime.
#
# Same DB-copy-then-query pattern as command-center/job-hunt/mine-fractional-apps.sh
# (never queries the live History DB directly -- Chrome/Arc lock it while
# running, so every read is against a throwaway copy). This script only ever
# touches THIS machine's own browser history and prints a report to the
# terminal -- nothing is written to any file this repo tracks, and nothing is
# uploaded anywhere. Run it locally; it is not, and cannot be, a web-app
# feature (a browser tab has no API to read another app's local History file).
#
# Two match patterns, per docs/APPLICATION-TRACKING.md's channel taxonomy:
#
#   1. Fillout apply-forms (fillout.com/t/...) -- the same SaaS product the
#      fractional-jobs tracker hits, so the exact same URL shape applies here;
#      only the encoded query params differ. This tool's forms are expected to
#      encode study_id/network/site/pay (adjust the param names below once a
#      real Fillout-hosted study form is seen -- none of this tool's tracked
#      networks are confirmed on Fillout yet, see the study's own risk note).
#
#   2. Syndicated/external applications -- these land on an arbitrary
#      third-party site per network, so there's no one fixed URL shape yet.
#      SYNDICATED_DOMAINS below is an intentionally short, EDITABLE allowlist:
#      add your own network's actual apply-page domain here as you identify
#      it (e.g. after submitting through it once). Only a listed domain whose
#      URL also looks like an apply/application page is matched, so this can
#      never turn into a general history dump. Empty by default -- ships with
#      zero real network domains hardcoded, exactly as intended for v1.
SYNDICATED_DOMAINS=(
  # "your-network-portal.example.com"   # <- add real syndicated apply-page domains here, one per line
)

command -v sqlite3 >/dev/null 2>&1 || { echo "mine-study-applications.sh: sqlite3 is required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "mine-study-applications.sh: python3 is required" >&2; exit 1; }

TMP=$(mktemp -d)
dec(){ python3 -c "import sys,urllib.parse;print(urllib.parse.unquote(sys.argv[1]))" "$1" 2>/dev/null; }
host(){ python3 -c "import sys,urllib.parse;print(urllib.parse.urlparse(sys.argv[1]).netloc)" "$1" 2>/dev/null; }

# Build the WHERE clause: fillout.com/t/ is always matched; each configured
# syndicated domain adds its own (domain AND apply-ish-path) clause.
WHERE="url LIKE '%fillout.com/t/%'"
for d in "${SYNDICATED_DOMAINS[@]}"; do
  WHERE="$WHERE OR (url LIKE '%${d}%' AND (url LIKE '%pply%' OR url LIKE '%nroll%'))"
done

{
for db in "$HOME/Library/Application Support/Google/Chrome/"*/History \
          "$HOME/Library/Application Support/Arc/User Data/"*/History; do
  [ -f "$db" ] || continue
  cp "$db" "$TMP/h.db" 2>/dev/null || continue
  sqlite3 "$TMP/h.db" "SELECT datetime(last_visit_time/1000000-11644473600,'unixepoch'),url FROM urls WHERE $WHERE;" 2>/dev/null
done
} | sort > "$TMP/raw.txt"

while IFS='|' read -r d url; do
  [ -z "$url" ] && continue
  if [[ "$url" == *"fillout.com/t/"* ]]; then
    net=$(dec "$(echo "$url"|grep -oE 'network=[^&]*'|head -1|sed 's/network=//')")
    sid=$(dec "$(echo "$url"|grep -oE 'study_id=[^&]*'|head -1|sed 's/study_id=//')")
    site=$(dec "$(echo "$url"|grep -oE 'site=[^&]*'|head -1|sed 's/site=//')")
    pay=$(dec "$(echo "$url"|grep -oE 'pay=[^&]*'|head -1|sed 's/pay=//')")
    [ -z "$net" ] && net="(fillout form)"
  else
    net=$(host "$url")
    sid=$(echo "$url" | grep -oE '[0-9]{2,}' | tail -1)
    site=""
    pay=""
  fi
  [ -z "$sid" ] && sid="(unparsed)"
  printf "%s\t%s\t%s\t%s\t%s\n" "${d%% *}" "$net" "$sid" "$site" "$pay"
done < "$TMP/raw.txt" | awk -F'\t' '!seen[$2"|"$3]++' | \
  awk -F'\t' 'BEGIN{printf "%-11s | %-28s | %-14s | %-10s | %s\n","DATE","NETWORK","STUDY ID","SITE","PAY"; for(i=0;i<78;i++)printf "-"; print ""} {printf "%-11s | %-28s | %-14s | %-10s | %s\n",$1,$2,$3,$4,$5}'

rm -rf "$TMP"
