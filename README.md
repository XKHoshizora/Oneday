<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/readme/hero-dark.svg">
    <img src="./docs/readme/hero-light.svg" width="100%" alt="有朝 Oneday, a native iOS proxy client. Beside the paper-boat app icon, the home-screen verse reads: 直到有一天 / 愿你不再需要连接。/ 在那之前，让连接简单一点。">
  </picture>
</p>

<p align="center">
  <strong>愿有朝一日，你不再需要这个 App。</strong><br>
  For a future where this app is no longer needed.<br>
  いつか、このアプリが必要なくなる日を願って。
</p>

<p align="center">
  <a href="docs/ONEDAY-IOS.md">Build guide</a> ·
  <a href="docs/ONEDAY-UPSTREAM.md">Upstream and attribution</a> ·
  <a href="docs/ONEDAY-ICON.md">App icon</a> ·
  <a href="LICENSE">GPL-3.0</a>
</p>

> [!NOTE]
> Oneday is a personal prototype. Builds go to TestFlight internal testing only; it is not on the App Store.

## What it does

- **Subscriptions.** Import a Clash/Mihomo subscription over HTTPS or from a local YAML file, then refresh it from the app.
- **Node links.** Paste `vless://` (VLESS + REALITY) and `hysteria2://` links, one or several at a time.
- **One switch.** Choose a node and connect. A Packet Tunnel extension runs mihomo with that node.
- **Follows the system.** The interface switches between light and dark with iOS.
- **Stays on the device.** Subscription URLs, credentials and runtime configuration are kept in the app's App Group storage. Subscriptions are fetched directly, without a third-party conversion service.

## How it fits together

| Part | Path | Role |
| --- | --- | --- |
| Interface | [`mobile/`](mobile) | React UI in a WKWebView: import, parse, choose a node |
| Host app | [`ios/App`](ios/App) | Swift host: fetches subscriptions, saves the profile, starts the tunnel |
| Tunnel | [`ios/PacketTunnel`](ios/PacketTunnel) | Network Extension that runs the mihomo core |
| Desktop base | [`src/`](src), [`src-tauri/`](src-tauri) | Clash Verge Rev v2.5.8, kept with its history |

## Build

You need macOS, Xcode 27 or newer, Node.js, pnpm 12 and XcodeGen. From the repository root:

```bash
bash scripts/ios-prepare.sh
```

This downloads the pinned, checksum-verified mihomo SDK, builds the interface and generates the Xcode project. For a device build, copy `ios/Signing.example.xcconfig` to `ios/Signing.local.xcconfig`, enter your Team ID, and build the `Oneday` scheme in Xcode.

The simulator covers the interface and subscription handling; VPN traffic needs a signed iPhone. Simulator commands, tests and signing details are in the [build guide](docs/ONEDAY-IOS.md).

## Current limits

- The selected node carries all traffic, with local networks direct. Rules, policy groups, scripts and geodata from desktop profiles are not imported.
- Subscriptions that only reference proxy providers, without an inline `proxies` list, are not supported yet.
- Node links are limited to `vless://` and `hysteria2://` (`hy2://`) for now.

## Built on Clash Verge Rev

Oneday is a fork of [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev) v2.5.8. The desktop client's source and history remain in this repository, and its original introduction is kept in [README.upstream.md](README.upstream.md).

With thanks to:

- [clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev), the desktop base.
- [zzzgydi/clash-verge](https://github.com/zzzgydi/clash-verge), the original Clash Verge.
- [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo), the proxy core.
- [ProjectClash/Clash](https://github.com/ProjectClash/Clash), the Apple mihomo SDK.
- [ProjectClash/Clash-Adapter](https://github.com/ProjectClash/Clash-Adapter), the packet-flow bridge.

Pinned versions, commits and checksums are listed in [ONEDAY-UPSTREAM.md](docs/ONEDAY-UPSTREAM.md).

## Star History

<a href="https://www.star-history.com/?repos=XKHoshizora%2FOneday&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=XKHoshizora/Oneday&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=XKHoshizora/Oneday&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=XKHoshizora/Oneday&type=date&legend=top-left" />
 </picture>
</a>

## License

GPL-3.0-only, as a derivative of Clash Verge Rev. See [LICENSE](LICENSE). Component notices ship with the app in [`ios/App/Resources/Licenses`](ios/App/Resources/Licenses).
