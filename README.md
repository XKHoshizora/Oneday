# Oneday

**有朝 · Oneday · いつか**

> 愿有朝一日，你不再需要这个 App。
>
> For a future where this app is no longer needed.
>
> いつか、このアプリが必要なくなる日を願って。

Oneday is an early-stage native iOS proxy client project for personal use.

## Status

An iOS prototype based on **Clash Verge Rev v2.5.8** is under development. The stable desktop source and history are preserved in this repository. The mobile interface is in `mobile/`; the Swift host and Packet Tunnel extension are in `ios/`.

See [iOS build and signing instructions](docs/ONEDAY-IOS.md) and [upstream versions and attribution](docs/ONEDAY-UPSTREAM.md). The original desktop project's introduction is preserved in [README.upstream.md](README.upstream.md).

## Initial goals

- Import and refresh Clash/Mihomo subscriptions.
- Support VLESS + REALITY and Hysteria2.
- Build and sign the app with your own Apple Developer account.

The first prototype uses inline Clash nodes with a global connection. Simulator checks cover the interface and subscription processing; system VPN traffic requires validation on a signed physical iPhone. Provider-only subscriptions and desktop feature parity are outside the initial prototype.

## License

GPL-3.0-only. See [LICENSE](LICENSE) and the pinned component notices in the iOS resources.
