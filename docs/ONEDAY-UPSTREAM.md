# Oneday upstream sources

## Desktop base

- Project: https://github.com/clash-verge-rev/clash-verge-rev
- Version: v2.5.8
- Commit: 4337bd85758d54d7b9044b2da3c9ac1176eae1f3
- License: GPL-3.0-only, retained in the repository root.
- Original project introduction: [README.upstream.md](../README.upstream.md).

The initial Oneday history is merged with the upstream stable history. The mobile prototype is an additional platform target; the upstream desktop application remains in the root source directories.

## Apple mihomo SDK

- Project: https://github.com/ProjectClash/Clash
- SDK release: v1.19.33-clash.3, based on mihomo v1.19.33.
- SDK archive SHA-256: `527462313d8353167fa453ece044da90f20bd4cb6d51e394c87af13ee372dd1d`.
- Source and dependency manifest: https://github.com/ProjectClash/Clash/releases/download/v1.19.33-clash.3/SOURCES.json
- SDK license: GPL-3.0. Component notices are bundled with the application.

This SDK supplies the embedded proxy engine. Oneday does not use the ProjectClash application interface or configuration-management implementation.

## Apple packet-flow adapter

- Project: https://github.com/ProjectClash/Clash-Adapter
- Commit: bdf40d4148eca4ead785fe54d724abd79d020876
- License: GPL-3.0, retained alongside the sources.

`PacketFlowBridge.swift` and `ProviderLifecycle.swift` are vendored unchanged under `ios/ThirdParty/ClashAdapter`. They supply the public NEPacketTunnelFlow socket-pair bridge, physical network inventory, and egress binding. The provider and lifecycle integration in `ios/PacketTunnel/PacketTunnelProvider.swift` are Oneday code.
