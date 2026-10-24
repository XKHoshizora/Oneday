# Oneday iOS prototype

The desktop source is imported from Clash Verge Rev v2.5.8. Its history and license are preserved. The iOS prototype lives alongside that source, with a small React interface and a Swift WebKit host. Desktop Tauri services are not loaded on iOS.

## Build

Use macOS, Xcode 27 or newer, Node.js, pnpm 12, and XcodeGen (`brew install xcodegen`). From the repository root:

```sh
bash scripts/ios-prepare.sh
```

The preparation script downloads a pinned, checksum-verified Apple SDK. The framework and generated web bundle are build products and are not committed.

For simulator development:

```sh
xcodebuild -project ios/Oneday.xcodeproj -scheme Oneday \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/build-simulator \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
```

Local signing is needed for App Group storage even in the simulator. The app uses the Scene lifecycle required by current iOS SDKs. The simulator validates the interface, message bridge, subscription download, parsing, and persistence. It does not validate the system VPN packet tunnel.

For device signing, copy `ios/Signing.example.xcconfig` to `ios/Signing.local.xcconfig`, enter your Team ID, and build the `Oneday` scheme in Xcode with automatic signing. Both application identifiers and `group.io.github.xkhoshizora.oneday` must belong to the same developer team. Keep local signing files, provisioning profiles, certificates, and subscriptions out of Git.

## Prototype behavior

- Import an HTTPS subscription or a local Clash/Mihomo YAML file.
- Select an inline node from the `proxies` list, then connect or disconnect.
- REALITY, Vision, TLS, Hysteria2 obfuscation, and port-hopping options remain in the outbound configuration passed to the core.
- The prototype uses the selected node globally, with local network routes direct. Desktop rules, policy groups, scripts, and geodata are not imported into this minimal runtime.
- Provider-only profiles without an inline `proxies` list are not supported yet. Invalid profiles do not replace the saved subscription.
- Subscription URLs, credentials, and runtime configuration stay in the app's protected App Group storage. The subscription is fetched directly without a third-party conversion service.

## Validation

`pnpm --dir mobile test` checks that REALITY and Hysteria2 parameters survive YAML import and runtime generation. It also checks rejection of invalid containers and selections.

The hosted `SubscriptionIntegrationTests` tests check the Scene window and simulator VPN handling, then refresh an already-imported subscription through the actual iOS URLSession client. Without a saved subscription, it is skipped. This performs a network request to the subscription URL stored locally in the app; no credentials are in the test source.

```sh
xcodebuild -project ios/Oneday.xcodeproj -scheme Oneday \
  -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_ID' \
  -derivedDataPath ios/build-simulator \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test
```

VPN traffic forwarding, DNS behavior, network changes, and extension memory still require a signed physical iPhone. A successful build or simulator test is not evidence of those behaviors.

## Upstream components

See [ONEDAY-UPSTREAM.md](ONEDAY-UPSTREAM.md) for pinned versions and source attribution. The GPL-3.0 license applies to this derivative. Additional component notices are bundled under `ios/App/Resources/Licenses`.
