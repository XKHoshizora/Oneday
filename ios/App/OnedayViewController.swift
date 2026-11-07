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
    private var keyboardObserver: NSObjectProtocol?
    private var pageOffset: NSKeyValueObservation?
    private var lastStatus = NEVPNStatus.invalid
    private var routingData: String?
    private var loading: Task<Void, Never>?

    override func viewDidLoad() {
        super.viewDidLoad()
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(assets, forURLScheme: "oneday")
        configuration.userContentController.addScriptMessageHandler(NativeHandler(owner: self), contentWorld: .page, name: "oneday")
        webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        // Also the launch screen color; both match the page's --bg in each appearance.
        webView.backgroundColor = UIColor(named: "Background")
        view.backgroundColor = webView.backgroundColor
        webView.navigationDelegate = self
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        // The page keeps its full height and moves its sheets with the keyboard. WebKit lays a resized
        // page out only after most of the keyboard animation, so ending the view at the keyboard made
        // them snap; and WebKit's visual viewport misses the accessory bar and keyboards that grow.
        keyboardObserver = NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] note in
            let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
            let duration = note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0
            MainActor.assumeIsolated { self?.keyboardWillChange(to: end, duration: duration) }
        }
        // The page never scrolls as a whole; its pages scroll inside it. WebKit still scrolls it to
        // clear the keyboard for a focused field, which would move the whole screen.
        pageOffset = webView.scrollView.observe(\.contentOffset) { scrollView, _ in
            MainActor.assumeIsolated {
                if scrollView.contentOffset != .zero, scrollView.zoomScale <= scrollView.minimumZoomScale { scrollView.contentOffset = .zero }
            }
        }
        routingData = RoutingData.prepare()
        webView.load(URLRequest(url: URL(string: "oneday://app/index.html")!))
        loading = Task { try? await tunnel.load() }
        statusObserver = NotificationCenter.default.addObserver(forName: .NEVPNStatusDidChange, object: nil, queue: .main) { [weak self] note in
            guard let status = (note.object as? NEVPNConnection)?.status else { return }
            MainActor.assumeIsolated { self?.statusChanged(status) }
        }
    }

    // An undocked or floating keyboard covers nothing at the bottom of the page.
    private func keyboardWillChange(to end: CGRect?, duration: Double) {
        guard let end, let screen = view.window?.windowScene?.screen else { return }
        let frame = screen.coordinateSpace.convert(end, to: view)
        let height = frame.maxY >= view.bounds.maxY - 1 ? max(0, view.bounds.maxY - frame.minY) : 0
        webView.evaluateJavaScript("window.onedayKeyboard?.(\(Int(height.rounded())), \(Int(duration * 1000)))")
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
            // Until the saved VPN configuration loads, the status would read as disconnected.
            await loading?.value
            var result: [String: Any] = ["status": tunnel.status, "tunnelAvailable": tunnel.isSupported]
            if let data = try OnedayStore.read("profile.json") { result["profile"] = try JSONSerialization.jsonObject(with: data) }
            // Unreadable exceptions are dropped rather than keeping the saved nodes from loading.
            if let data = try OnedayStore.read("routing.json"), let routing = try? JSONSerialization.jsonObject(with: data) { result["routing"] = routing }
            if let routingData { result["routingData"] = routingData }
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
        case "saveRouting":
            guard let routing = args["routing"] as? [String: Any], let rules = routing["rules"] as? [[String: Any]], rules.count <= 300 else {
                throw OnedayError.message("Invalid routing rules.")
            }
            let data = try JSONSerialization.data(withJSONObject: routing)
            guard data.count <= 256 * 1024 else { throw OnedayError.message("Routing rules would exceed 256 KB.") }
            let previous = try OnedayStore.read("routing.json")
            try OnedayStore.write(data, to: "routing.json")
            do {
                if args["configuration"] != nil { try await tunnel.apply(configuration: Self.configuration(args)) }
            } catch {
                if let previous { try? OnedayStore.write(previous, to: "routing.json") } else { try? OnedayStore.remove("routing.json") }
                throw error
            }
            return true
        case "applyConfiguration":
            try await tunnel.apply(configuration: Self.configuration(args))
            return true
        case "connect":
            try await tunnel.connect(configuration: Self.configuration(args))
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

    private static func configuration(_ args: [String: Any]) throws -> String {
        guard let configuration = args["configuration"] as? String, configuration.utf8.count <= SubscriptionClient.maximumBytes else {
            throw OnedayError.message("Missing or oversized VPN configuration.")
        }
        return configuration
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
