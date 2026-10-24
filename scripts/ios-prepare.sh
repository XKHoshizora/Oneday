#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_VERSION="v1.19.33-clash.3"
SDK_SHA256="527462313d8353167fa453ece044da90f20bd4cb6d51e394c87af13ee372dd1d"
SDK_BASE="https://github.com/ProjectClash/Clash/releases/download/$SDK_VERSION"

if [[ ! -d "$ROOT/ios/Frameworks/Clash.xcframework" ]]; then
  SDK_TEMP="$(mktemp -d)"
  trap 'rm -rf "$SDK_TEMP"' EXIT
  curl --fail --location --retry 2 "$SDK_BASE/Clash.xcframework.zip" -o "$SDK_TEMP/sdk.zip"
  printf '%s  %s\n' "$SDK_SHA256" "$SDK_TEMP/sdk.zip" | shasum -a 256 -c -
  unzip -q "$SDK_TEMP/sdk.zip" -d "$SDK_TEMP/unpacked"
  mkdir -p "$ROOT/ios/Frameworks"
  cp -R "$SDK_TEMP/unpacked/Clash.xcframework" "$ROOT/ios/Frameworks/"
fi

pnpm --dir "$ROOT/mobile" install --ignore-workspace --frozen-lockfile --config.manage-package-manager-versions=false
pnpm --dir "$ROOT/mobile" run build
xcodegen generate --spec "$ROOT/ios/project.yml"
printf '\nOpen ios/Oneday.xcodeproj and select your Apple Developer team.\n'
