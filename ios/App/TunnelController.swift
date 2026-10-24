import Foundation
import NetworkExtension

@MainActor
final class TunnelController {
    private(set) var manager: NETunnelProviderManager?

    var isSupported: Bool {
#if targetEnvironment(simulator)
        false
#else
        true
#endif
    }

    func load() async throws {
#if !targetEnvironment(simulator)
        let managers = try await NETunnelProviderManager.loadAllFromPreferences()
        manager = managers.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == OnedayIdentifiers.tunnelBundle }
#endif
    }

    var status: String {
        switch manager?.connection.status ?? .disconnected {
        case .connected: return "connected"
        case .connecting: return "connecting"
        case .disconnecting: return "disconnecting"
        case .reasserting: return "reasserting"
        case .invalid: return "invalid"
        case .disconnected: return "disconnected"
        @unknown default: return "disconnected"
        }
    }

    var canChangeProfile: Bool { status == "disconnected" || status == "invalid" }

    func connect(configuration: String) async throws {
#if targetEnvironment(simulator)
        throw OnedayError.message("模拟器可测试订阅和界面；系统 VPN 流量转发需要在签名后的 iPhone 上验证。")
#else
        try await load()
        guard canChangeProfile else { throw OnedayError.message("Disconnect before changing configurations.") }
        try OnedayStore.write(Data(configuration.utf8), to: "runtime.yaml")
        OnedayStore.writeError(nil)
        let manager = manager ?? NETunnelProviderManager()
        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = OnedayIdentifiers.tunnelBundle
        proto.serverAddress = "Oneday"
        proto.providerConfiguration = ["schemaVersion": 1]
        proto.disconnectOnSleep = false
        proto.includeAllNetworks = false
        manager.protocolConfiguration = proto
        manager.localizedDescription = "Oneday · 有朝"
        manager.isEnabled = true
        try await manager.saveToPreferences()
        try await manager.loadFromPreferences()
        self.manager = manager
        try manager.connection.startVPNTunnel()
#endif
    }

    func disconnect() { manager?.connection.stopVPNTunnel() }
}
