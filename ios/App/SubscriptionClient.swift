import Foundation

final class SubscriptionClient: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    static let maximumBytes = 4 * 1024 * 1024

    func fetch(_ value: String) async throws -> String {
        guard let url = URL(string: value), url.scheme?.lowercased() == "https", url.host != nil else {
            throw OnedayError.message("Please use an HTTPS subscription URL.")
        }
        let session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 25)
        request.setValue("ClashMeta/1.19.33 Oneday/0.1", forHTTPHeaderField: "User-Agent")
        request.setValue("application/yaml, text/yaml, text/plain", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw OnedayError.message("The subscription server did not return a successful response.")
        }
        guard response.expectedContentLength <= Self.maximumBytes else { throw OnedayError.message("Subscription exceeds 4 MB.") }
        var data = Data()
        for try await byte in bytes {
            guard data.count < Self.maximumBytes else { throw OnedayError.message("Subscription exceeds 4 MB.") }
            data.append(byte)
        }
        guard let content = String(data: data, encoding: .utf8) else { throw OnedayError.message("The subscription is not UTF-8 text.") }
        return content
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url?.scheme?.lowercased() == "https" ? request : nil)
    }
}
