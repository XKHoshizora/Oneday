import Clash
import Foundation
import NetworkExtension

final class PacketTunnelProvider: NEPacketTunnelProvider, ClashPlatformInterfaceProtocol {
    private let coreQueue = DispatchQueue(label: "io.github.xkhoshizora.oneday.core")
    private let pathQueue = DispatchQueue(label: "io.github.xkhoshizora.oneday.path")
    private let pathLock = NSLock()
    private let monitor = ApplePhysicalPathMonitor()
    private var path: PhysicalPathSnapshot?
    private var listener: (any ClashInterfaceUpdateListenerProtocol)?
    private var service: ClashBoxService?
    private var bridge: PacketFlowBridge?

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        coreQueue.async { [self] in
            do {
                let container = try OnedayStore.directory
                guard let data = try OnedayStore.read("runtime.yaml"), let yaml = String(data: data, encoding: .utf8), !yaml.isEmpty else {
                    throw OnedayError.message("Import a Clash subscription and select a node before connecting.")
                }
                for name in ["working", "temp"] {
                    try FileManager.default.createDirectory(at: container.appendingPathComponent(name), withIntermediateDirectories: true)
                }
                let setup = ClashSetupOptions()
                setup.basePath = container.path
                setup.workingPath = container.appendingPathComponent("working").path
                setup.tempPath = container.appendingPathComponent("temp").path
                setup.runtimeProfile = "iosPacketTunnel"
                setup.tunIPv6Mode = "enabled"
                setup.ipQueryMode = "config"
                setup.tunMTU = 1400
                setup.logMaxLines = 100
                setup.maxProcs = 2
                setup.includeAllNetworks = false
                var error: NSError?
                ClashSetup(setup, &error)
                if let error { throw error }
                let ready = DispatchSemaphore(value: 0)
                monitor.updateHandler = { [weak self] snapshot in
                    guard let self else { return }
                    pathLock.lock()
                    path = snapshot
                    let target = listener
                    pathLock.unlock()
                    target?.updateDefaultInterface(snapshot.interfaceName, interfaceIndex: Int32(bitPattern: snapshot.interfaceIndex), isExpensive: snapshot.expensive, isConstrained: snapshot.constrained, supportsIPv4: snapshot.supportsIPv4, supportsIPv6: snapshot.supportsIPv6)
                    if snapshot.isReady { ready.signal() }
                }
                monitor.start(queue: pathQueue)
                guard ready.wait(timeout: .now() + 10) == .success else { throw OnedayError.message("No physical network is available.") }
                guard let core = ClashNewService(self, &error) else { throw (error as Error?) ?? OnedayError.message("The VPN core could not be created.") }
                if let error { throw error }
                service = core
                try core.start(yaml)
                OnedayStore.writeError(nil)
                completionHandler(nil)
            } catch {
                OnedayStore.writeError(error)
                cleanup()
                completionHandler(error)
            }
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        coreQueue.async { [self] in cleanup(); completionHandler() }
    }

    // The app's only message is a poll for the live speed readout.
    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        coreQueue.async { [self] in completionHandler?(service == nil ? nil : Data(ClashTrafficJSON().utf8)) }
    }

    private func cleanup() {
        try? service?.close()
        service = nil
        bridge?.stop()
        bridge = nil
        monitor.cancel()
        pathLock.lock(); listener = nil; pathLock.unlock()
    }

    func openTun(_ options: (any ClashTunOptionsProtocol)?, ret0_: UnsafeMutablePointer<Int32>?) throws {
        guard let options, let ret0_ else { throw OnedayError.message("Missing tunnel options.") }
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "127.0.0.1")
        settings.mtu = NSNumber(value: options.getMTU())
        let dnsAddress = try options.getDNSServerAddress().value
        guard !dnsAddress.isEmpty else { throw OnedayError.message("The VPN DNS address is unavailable.") }
        let dns = NEDNSSettings(servers: [dnsAddress])
        dns.matchDomains = [""]
        dns.matchDomainsNoSearch = true
        settings.dnsSettings = dns
        var v4Addresses: [String] = [], v4Masks: [String] = []
        if let iterator = options.getInet4Address() {
            while iterator.hasNext(), let prefix = iterator.next() { v4Addresses.append(prefix.address()); v4Masks.append(prefix.mask()) }
        }
        if !v4Addresses.isEmpty {
            let v4 = NEIPv4Settings(addresses: v4Addresses, subnetMasks: v4Masks)
            let routes = ipv4Routes(options.getInet4RouteAddress())
            v4.includedRoutes = routes.isEmpty ? [.default()] : routes
            v4.excludedRoutes = ipv4Routes(options.getInet4RouteExcludeAddress())
            settings.ipv4Settings = v4
        }
        var v6Addresses: [String] = [], v6Prefixes: [NSNumber] = []
        if let iterator = options.getInet6Address() {
            while iterator.hasNext(), let prefix = iterator.next() { v6Addresses.append(prefix.address()); v6Prefixes.append(NSNumber(value: prefix.prefix())) }
        }
        if !v6Addresses.isEmpty {
            let v6 = NEIPv6Settings(addresses: v6Addresses, networkPrefixLengths: v6Prefixes)
            let routes = ipv6Routes(options.getInet6RouteAddress())
            v6.includedRoutes = routes.isEmpty ? [.default()] : routes
            v6.excludedRoutes = ipv6Routes(options.getInet6RouteExcludeAddress())
            settings.ipv6Settings = v6
        }
        let applied = DispatchSemaphore(value: 0)
        var settingsError: Error?
        setTunnelNetworkSettings(settings) { error in settingsError = error; applied.signal() }
        guard applied.wait(timeout: .now() + 20) == .success else { throw OnedayError.message("Timed out while configuring the system VPN.") }
        if let settingsError { throw settingsError }
        let bridge = PacketFlowBridge(packetFlow: packetFlow, maxPendingPackets: 256, maxPendingBytes: 1024 * 1024) { [weak self] error in
            OnedayStore.writeError(error)
            self?.cancelTunnelWithError(error)
        }
        ret0_.pointee = try bridge.start()
        self.bridge = bridge
    }

    private func ipv4Routes(_ iterator: (any ClashRoutePrefixIteratorProtocol)?) -> [NEIPv4Route] {
        guard let iterator else { return [] }
        var routes: [NEIPv4Route] = []
        while iterator.hasNext(), let prefix = iterator.next() { routes.append(NEIPv4Route(destinationAddress: prefix.address(), subnetMask: prefix.mask())) }
        return routes
    }

    private func ipv6Routes(_ iterator: (any ClashRoutePrefixIteratorProtocol)?) -> [NEIPv6Route] {
        guard let iterator else { return [] }
        var routes: [NEIPv6Route] = []
        while iterator.hasNext(), let prefix = iterator.next() { routes.append(NEIPv6Route(destinationAddress: prefix.address(), networkPrefixLength: NSNumber(value: prefix.prefix()))) }
        return routes
    }

    func startDefaultInterfaceMonitor(_ listener: (any ClashInterfaceUpdateListenerProtocol)?) throws {
        pathLock.lock()
        self.listener = listener
        let snapshot = path
        pathLock.unlock()
        guard let snapshot, snapshot.isReady else { throw OnedayError.message("No active physical interface.") }
        listener?.updateDefaultInterface(snapshot.interfaceName, interfaceIndex: Int32(bitPattern: snapshot.interfaceIndex), isExpensive: snapshot.expensive, isConstrained: snapshot.constrained, supportsIPv4: snapshot.supportsIPv4, supportsIPv6: snapshot.supportsIPv6)
    }

    func closeDefaultInterfaceMonitor(_ listener: (any ClashInterfaceUpdateListenerProtocol)?) throws {
        pathLock.lock(); self.listener = nil; pathLock.unlock()
    }

    func getInterfaces() throws -> any ClashNetworkInterfaceIteratorProtocol {
        pathLock.lock(); let snapshot = path; pathLock.unlock()
        return InterfaceIterator(PhysicalInterfaceInventory.build(raw: PhysicalInterfaceInventory.enumerate(), available: snapshot?.availableInterfaces ?? [], pathIsExpensive: snapshot?.expensive ?? false, defaultInterfaceIndex: snapshot?.interfaceIndex ?? 0, ownTunnelAddresses: []))
    }

    func underNetworkExtension() -> Bool { true }
    func usePlatformAutoDetectControl() -> Bool { true }
    func autoDetectControl(_ fd: Int32) throws {
        pathLock.lock(); let index = path?.interfaceIndex ?? 0; pathLock.unlock()
        try PhysicalEgressBinding.apply(.decision(interfaceIndex: index), to: fd)
    }
    func writeLog(_ message: String?) {}
}

private final class StringIterator: NSObject, ClashStringIteratorProtocol {
    private var values: [String]
    private var index = 0
    init(_ values: [String]) { self.values = values }
    func hasNext() -> Bool { index < values.count }
    func len() -> Int32 { Int32(values.count) }
    func next() -> String { defer { index += 1 }; return values[index] }
}

private final class InterfaceIterator: NSObject, ClashNetworkInterfaceIteratorProtocol {
    private let records: [PhysicalInterfaceInventory.Record]
    private var index = 0
    init(_ records: [PhysicalInterfaceInventory.Record]) { self.records = records }
    func hasNext() -> Bool { index < records.count }
    func len() -> Int32 { Int32(records.count) }
    func next() -> ClashNetworkInterface? {
        guard hasNext() else { return nil }
        let record = records[index]
        index += 1
        let result = ClashNetworkInterface()
        result.name = record.name; result.index = Int32(bitPattern: record.index); result.mtu = record.mtu
        result.addresses = StringIterator(record.addresses); result.flags = record.flags.rawValue
        result.type = record.type.rawValue; result.metered = record.metered
        return result
    }
}
