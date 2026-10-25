import Foundation
import XCTest
import UIKit
@testable import Oneday

final class SubscriptionIntegrationTests: XCTestCase {
    @MainActor
    func testSceneCreatesTheAppWindow() throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let delegate = try XCTUnwrap(scene.delegate as? SceneDelegate)
        XCTAssertTrue(delegate.window?.rootViewController is OnedayViewController)
    }

#if targetEnvironment(simulator)
    @MainActor
    func testSimulatorHandlesUnavailableVPNService() async throws {
        let tunnel = TunnelController()
        try await tunnel.load()
        XCTAssertFalse(tunnel.isSupported)
        XCTAssertEqual(tunnel.status, "disconnected")
        do {
            try await tunnel.connect(configuration: "")
            XCTFail("The simulator must not start a system VPN tunnel.")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("模拟器"))
        }
    }
#endif

    func testSavedSubscriptionCanBeRefreshed() async throws {
        // Profiles keep each subscription as a source; ones saved before node groups held a single URL.
        guard let data = try OnedayStore.read("profile.json"),
              var profile = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw XCTSkip("Import an authorized subscription in the app before running this network integration test.")
        }
        var sources = profile["sources"] as? [[String: Any]] ?? []
        let index = sources.firstIndex { $0["url"] is String }
        guard let url = index.flatMap({ sources[$0]["url"] as? String }) ?? profile["sourceURL"] as? String else {
            throw XCTSkip("Import an authorized subscription in the app before running this network integration test.")
        }
        let content = try await SubscriptionClient().fetch(url)
        XCTAssertFalse(content.isEmpty)
        XCTAssertLessThanOrEqual(content.utf8.count, SubscriptionClient.maximumBytes)
        XCTAssertTrue(content.contains("proxies:"), "The server must return Clash YAML to the app's User-Agent.")
        if let index {
            sources[index]["yaml"] = content
            profile["sources"] = sources
        } else {
            profile["yaml"] = content
        }
        let updated = try JSONSerialization.data(withJSONObject: profile)
        try OnedayStore.write(updated, to: "profile.json")
        XCTAssertTrue(try OnedayStore.read("profile.json") == updated, "The refreshed subscription must survive a storage round trip.")
    }
}
