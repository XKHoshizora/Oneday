import Darwin
import Foundation

final class SubscriptionClient: @unchecked Sendable {
    static let maximumBytes = 4 * 1024 * 1024

    func fetch(_ value: String) async throws -> String {
        guard let url = URL(string: value), url.scheme?.lowercased() == "https", let host = url.host else {
            throw OnedayError.message("Please use an HTTPS subscription URL.")
        }
        let destinations = DestinationGuard(origin: host)
        let session = URLSession(configuration: .ephemeral, delegate: destinations, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 25)
        request.setValue("ClashMeta/1.19.33 Oneday/0.1", forHTTPHeaderField: "User-Agent")
        request.setValue("application/yaml, text/yaml, text/plain", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.bytes(for: request)
        if destinations.blockedRedirect { throw OnedayError.message("The subscription redirected to a local, private or non-HTTPS address.") }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw OnedayError.message("The subscription server did not return a successful response.")
        }
        guard response.expectedContentLength <= Self.maximumBytes else { throw OnedayError.message("Subscription exceeds 4 MB.") }
        var data = Data()
        for try await byte in bytes {
            guard data.count < Self.maximumBytes else { throw OnedayError.message("Subscription exceeds 4 MB.") }
            data.append(byte)
        }
        guard await destinations.connectedOnlyToAllowedAddresses() else {
            throw OnedayError.message("The subscription redirected to a local or private address.")
        }
        guard let content = String(data: data, encoding: .utf8) else { throw OnedayError.message("The subscription is not UTF-8 text.") }
        return content
    }
}

// Only the host the user typed may be local; other hosts reached by redirect must be public.
// Redirects are resolved before they are followed, and the addresses actually connected to are
// checked afterwards because DNS can answer differently the second time.
private final class DestinationGuard: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let origin: String
    private let lock = NSLock()
    private var metrics: URLSessionTaskMetrics?
    private var waiter: CheckedContinuation<URLSessionTaskMetrics?, Never>?
    private var completed = false
    private var blocked = false

    init(origin: String) { self.origin = origin.lowercased() }

    var blockedRedirect: Bool { lock.lock(); defer { lock.unlock() }; return blocked }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url, url.scheme?.lowercased() == "https", let host = url.host?.lowercased(),
              host == origin || PublicAddress.resolvesPublicly(host) else {
            lock.lock(); blocked = true; lock.unlock()
            return completionHandler(nil)
        }
        completionHandler(request)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        settle { $0.metrics = metrics }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        settle { $0.completed = true }
    }

    func connectedOnlyToAllowedAddresses() async -> Bool {
        guard let metrics = await collectedMetrics() else { return false }
        return metrics.transactionMetrics.allSatisfy { transaction in
            guard let host = transaction.request.url?.host?.lowercased(), host != origin else { return true }
            guard let address = transaction.remoteAddress else { return false }
            return PublicAddress.isPublic(address)
        }
    }

    private func collectedMetrics() async -> URLSessionTaskMetrics? {
        await withCheckedContinuation { continuation in
            lock.lock()
            if metrics != nil || completed {
                let result = metrics
                lock.unlock()
                return continuation.resume(returning: result)
            }
            waiter = continuation
            lock.unlock()
            DispatchQueue.global().asyncAfter(deadline: .now() + 5) { [weak self] in self?.settle { $0.completed = true } }
        }
    }

    // Metrics arrive before completion; whichever comes first wakes the waiting fetch.
    private func settle(_ update: (DestinationGuard) -> Void) {
        lock.lock()
        update(self)
        let pending = metrics != nil || completed ? waiter : nil
        if pending != nil { waiter = nil }
        let result = metrics
        lock.unlock()
        pending?.resume(returning: result)
    }
}

private enum PublicAddress {
    static func resolvesPublicly(_ host: String) -> Bool {
        var hints = addrinfo()
        hints.ai_socktype = SOCK_STREAM
        var list: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, "443", &hints, &list) == 0, let first = list else { return false }
        defer { freeaddrinfo(first) }
        var cursor: UnsafeMutablePointer<addrinfo>? = first
        while let entry = cursor {
            guard let address = entry.pointee.ai_addr, isPublic(address) else { return false }
            cursor = entry.pointee.ai_next
        }
        return true
    }

    static func isPublic(_ text: String) -> Bool {
        let literal = String(text.split(separator: "%").first ?? "")
        var v4 = in_addr(), v6 = in6_addr()
        if inet_pton(AF_INET, literal, &v4) == 1 { return withUnsafeBytes(of: &v4) { isPublic(v4: Array($0)) } }
        if inet_pton(AF_INET6, literal, &v6) == 1 { return withUnsafeBytes(of: &v6) { isPublic(v6: Array($0)) } }
        return false
    }

    private static func isPublic(_ address: UnsafeMutablePointer<sockaddr>) -> Bool {
        switch Int32(address.pointee.sa_family) {
        case AF_INET:
            return address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { pointer in
                var value = pointer.pointee.sin_addr
                return withUnsafeBytes(of: &value) { isPublic(v4: Array($0)) }
            }
        case AF_INET6:
            return address.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { pointer in
                var value = pointer.pointee.sin6_addr
                return withUnsafeBytes(of: &value) { isPublic(v6: Array($0)) }
            }
        default:
            return false
        }
    }

    private static func isPublic(v4 b: [UInt8]) -> Bool {
        switch (b[0], b[1], b[2]) {
        case (0, _, _), (10, _, _), (127, _, _), (169, 254, _), (192, 168, _), (192, 0, 0), (192, 0, 2),
             (198, 51, 100), (203, 0, 113): return false
        case (100, 64...127, _), (172, 16...31, _), (198, 18...19, _): return false
        default: return b[0] < 224
        }
    }

    private static func isPublic(v6 b: [UInt8]) -> Bool {
        let embedded = Array(b[12...])
        if b[0..<10].allSatisfy({ $0 == 0 }) && b[10] == 0xff && b[11] == 0xff { return isPublic(v4: embedded) }
        if b[0...11] == [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0] { return isPublic(v4: embedded) }
        if b[0..<12].allSatisfy({ $0 == 0 }) { return false }
        if b[0] & 0xfe == 0xfc || b[0] == 0xff || (b[0] == 0xfe && b[1] & 0xc0 == 0x80) { return false }
        if b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8 { return false }
        return true
    }
}
