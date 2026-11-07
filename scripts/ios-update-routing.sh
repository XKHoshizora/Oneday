#!/usr/bin/env bash
# Regenerates the China routing data bundled with the iOS app. Nothing in
# ios/App/Resources/Routing changes unless every download, conversion and check succeeds.
# Pin a source with DOMAIN_COMMIT or IP_COMMIT; otherwise the latest upstream commit is used.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/ios/App/Resources/Routing"
SDK="$ROOT/ios/Frameworks/Clash.xcframework/macos-arm64_x86_64"
SDK_VERSION="$(sed -n 's/^SDK_VERSION="\(.*\)"$/\1/p' "$ROOT/scripts/ios-prepare.sh")"
DOMAIN_REPO="felixonmars/dnsmasq-china-list"
IP_REPO="gaoyifan/china-operator-ip"

[[ -d "$SDK" ]] || { echo "Run scripts/ios-prepare.sh first to download the SDK." >&2; exit 1; }
DOMAIN_COMMIT="${DOMAIN_COMMIT:-$(git ls-remote "https://github.com/$DOMAIN_REPO.git" refs/heads/master | cut -f1)}"
IP_COMMIT="${IP_COMMIT:-$(git ls-remote "https://github.com/$IP_REPO.git" refs/heads/ip-lists | cut -f1)}"
[[ "$DOMAIN_COMMIT" =~ ^[0-9a-f]{40}$ && "$IP_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "Could not resolve upstream commits." >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fetch() { curl --fail --silent --show-error --location --retry 2 "https://raw.githubusercontent.com/$1/$2/$3" -o "$WORK/$4"; }
fetch "$DOMAIN_REPO" "$DOMAIN_COMMIT" accelerated-domains.china.conf domains.conf
fetch "$IP_REPO" "$IP_COMMIT" china.txt china.txt
fetch "$IP_REPO" "$IP_COMMIT" china6.txt china6.txt

# Every list entry becomes a domain-and-subdomains match; any other line shape stops the update.
grep -v -e '^#' -e '^$' "$WORK/domains.conf" > "$WORK/domains.lines"
if grep -qvE '^server=/[a-z0-9-]+(\.[a-z0-9-]+)*/114\.114\.114\.114$' "$WORK/domains.lines"; then
  echo "Unexpected line in $DOMAIN_REPO accelerated-domains.china.conf." >&2; exit 1
fi
mkdir "$WORK/data"
sed -E 's#^server=/(.*)/114\.114\.114\.114$#+.\1#' "$WORK/domains.lines" > "$WORK/data/cn-domain.txt"
if grep -qvE '^[0-9.]+/[0-9]+$' "$WORK/china.txt" || grep -qvE '^[0-9a-f:]+/[0-9]+$' "$WORK/china6.txt"; then
  echo "Unexpected line in $IP_REPO china.txt or china6.txt." >&2; exit 1
fi
cat "$WORK/china.txt" "$WORK/china6.txt" > "$WORK/data/cn-ip.txt"

xcrun swiftc -O -F "$SDK" -framework Clash -lresolv -framework Security -framework SystemConfiguration \
  -framework Network -framework IOKit "$ROOT/scripts/ios-routing-data.swift" -o "$WORK/compile" 2> "$WORK/swiftc.log" \
  || { cat "$WORK/swiftc.log" >&2; exit 1; }
"$WORK/compile" "$WORK/data" 2> "$WORK/compile.log" > "$WORK/counts" || { cat "$WORK/compile.log" >&2; exit 1; }
DOMAINS="$(awk '$1 == "cn-domain" { print $2 }' "$WORK/counts")"
IPS="$(awk '$1 == "cn-ip" { print $2 }' "$WORK/counts")"
# A truncated download still compiles, so a list far below its usual size is refused.
(( DOMAINS > 50000 && IPS > 5000 )) || { echo "Lists are unexpectedly small: $DOMAINS domains, $IPS IP ranges." >&2; exit 1; }

hash() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
cat > "$WORK/data/manifest.json" <<JSON
{
  "version": "$(date -u +%Y-%m-%d)",
  "sdk": "$SDK_VERSION",
  "files": {
    "cn-domain.mrs": "$(hash "$WORK/data/cn-domain.mrs")",
    "cn-ip.mrs": "$(hash "$WORK/data/cn-ip.mrs")"
  },
  "sources": [
    {
      "data": "cn-domain.mrs",
      "project": "https://github.com/$DOMAIN_REPO",
      "commit": "$DOMAIN_COMMIT",
      "files": ["accelerated-domains.china.conf"],
      "license": "WTFPL",
      "entries": $DOMAINS
    },
    {
      "data": "cn-ip.mrs",
      "project": "https://github.com/$IP_REPO",
      "commit": "$IP_COMMIT",
      "files": ["china.txt", "china6.txt"],
      "license": "MIT",
      "entries": $IPS
    }
  ]
}
JSON

mkdir -p "$OUT"
for file in cn-domain.mrs cn-ip.mrs manifest.json; do
  cp "$WORK/data/$file" "$OUT/.$file.new"
  chmod 644 "$OUT/.$file.new"
  mv -f "$OUT/.$file.new" "$OUT/$file"
done
printf 'Updated %s: %s domains from %s@%s, %s IP ranges from %s@%s.\n' \
  "${OUT#"$ROOT"/}" "$DOMAINS" "$DOMAIN_REPO" "${DOMAIN_COMMIT:0:7}" "$IPS" "$IP_REPO" "${IP_COMMIT:0:7}"
