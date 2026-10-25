import NetworkExtension
import UIKit
import WebKit

@MainActor
final class OnedayViewController: UIViewController, WKNavigationDelegate {
    private let tunnel = TunnelController()
    private let subscriptions = SubscriptionClient()
    private var webView: WKWebView!
    private let assets = AssetHandler()
    private var statusObserver: NSObjectProtocol?
    private var lastStatus = NEVPNStatus.invalid

    override func viewDidLoad() {
        super.viewDidLoad()
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(assets, forURLScheme: "oneday")
        configuration.userContentController.addScriptMessageHandler(NativeHandler(owner: self), contentWorld: .page, name: "oneday")
        webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        // Also the launch screen color; both match the page's --bg in each appearance.
        webView.backgroundColor = UIColor(named: "Background")
        webView.navigationDelegate = self
        view.addSubview(webView)
        webView.load(URLRequest(url: URL(string: "oneday://app/index.html")!))
        Task { try? await tunnel.load() }
        statusObserver = NotificationCenter.default.addObserver(forName: .NEVPNStatusDidChange, object: nil, queue: .main) { [weak self] note in
            guard let status = (note.object as? NEVPNConnection)?.status else { return }
            MainActor.assumeIsolated { self?.statusChanged(status) }
        }
    }

    // A single tap of feedback marks the moment the tunnel comes up, matching the page's sunrise.
    private func statusChanged(_ status: NEVPNStatus) {
        if status == .connected, lastStatus == .connecting { UINotificationFeedbackGenerator().notificationOccurred(.success) }
        lastStatus = status
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        decisionHandler(url?.scheme == "oneday" && url?.host == "app" ? .allow : .cancel)
    }

    // iOS reclaims the web content process of backgrounded apps, which leaves an empty page.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    fileprivate func invoke(_ message: WKScriptMessage) async throws -> Any {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "oneday", message.frameInfo.securityOrigin.host == "app",
              let body = message.body as? [String: Any], let method = body["method"] as? String else {
            throw OnedayError.message("Untrusted app message.")
        }
        let args = body["args"] as? [String: Any] ?? [:]
        switch method {
        case "getState":
            var result: [String: Any] = ["status": tunnel.status, "tunnelAvailable": tunnel.isSupported]
            if let data = try OnedayStore.read("profile.json") { result["profile"] = try JSONSerialization.jsonObject(with: data) }
            if let date = tunnel.connectedAt { result["connectedAt"] = date.timeIntervalSince1970 * 1000 }
            if tunnel.isSupported, let data = try OnedayStore.read("last-error.txt"), let error = String(data: data, encoding: .utf8), !error.isEmpty { result["lastError"] = error }
            return result
        case "fetchSubscription":
            guard let url = args["url"] as? String else { throw OnedayError.message("Missing subscription URL.") }
            return ["content": try await subscriptions.fetch(url)]
        case "saveProfile":
            guard tunnel.canChangeProfile, let profile = args["profile"] as? [String: Any], let sources = profile["sources"] as? [[String: Any]],
                  !sources.isEmpty, sources.allSatisfy({ ($0["yaml"] as? String)?.isEmpty == false }) else {
                throw OnedayError.message("Disconnect first and import a valid profile.")
            }
            let data = try JSONSerialization.data(withJSONObject: profile)
            // Each source is capped when imported; this bounds several of them together.
            guard data.count <= SubscriptionClient.maximumBytes * 2 else { throw OnedayError.message("Saved nodes would exceed 8 MB.") }
            try OnedayStore.write(data, to: "profile.json")
            return true
        case "connect":
            guard let configuration = args["configuration"] as? String, configuration.utf8.count <= SubscriptionClient.maximumBytes else { throw OnedayError.message("Missing or oversized VPN configuration.") }
            try await tunnel.connect(configuration: configuration)
            return true
        case "deleteProfile":
            guard tunnel.canChangeProfile else { throw OnedayError.message("Disconnect before deleting nodes.") }
            try OnedayStore.remove("profile.json")
            try OnedayStore.remove("runtime.yaml")
            return true
        case "getTraffic": return await tunnel.traffic()
        case "disconnect": tunnel.disconnect(); return true
        default: throw OnedayError.message("Unsupported app operation.")
        }
    }
}

@MainActor
private final class NativeHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: OnedayViewController?
    init(owner: OnedayViewController) { self.owner = owner }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        Task {
            do {
                guard let owner else { throw OnedayError.message("App is unavailable.") }
                replyHandler(try await owner.invoke(message), nil)
            } catch { replyHandler(nil, error.localizedDescription) }
        }
    }
}

private final class AssetHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        do {
            guard let root = Bundle.main.url(forResource: "Web", withExtension: nil), let url = urlSchemeTask.request.url,
                  url.host == "app", url.scheme == "oneday" else { throw OnedayError.message("Missing app resources.") }
            let path = url.path == "/" ? "index.html" : String(url.path.dropFirst())
            let file = root.appendingPathComponent(path).standardizedFileURL
            guard file.path.hasPrefix(root.standardizedFileURL.path + "/") else { throw OnedayError.message("Invalid resource path.") }
            let data = try Data(contentsOf: file)
            let mime = ["html": "text/html", "js": "application/javascript", "css": "text/css", "svg": "image/svg+xml", "json": "application/json"][file.pathExtension] ?? "application/octet-stream"
            urlSchemeTask.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: "utf-8"))
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch { urlSchemeTask.didFailWithError(error) }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
