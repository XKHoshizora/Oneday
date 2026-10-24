import Foundation

enum OnedayIdentifiers {
    static let appGroup = "group.io.github.xkhoshizora.oneday"
    static let tunnelBundle = "io.github.xkhoshizora.oneday.PacketTunnel"
}

enum OnedayError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case let .message(value) = self { return value }; return nil }
}

enum OnedayStore {
    static var directory: URL {
        get throws {
            guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: OnedayIdentifiers.appGroup) else {
                throw OnedayError.message("App Group unavailable. Check signing for the app and VPN extension.")
            }
            return url
        }
    }

    static func read(_ file: String) throws -> Data? {
        let url = try directory.appendingPathComponent(file)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try Data(contentsOf: url)
    }

    static func write(_ data: Data, to file: String) throws {
        let url = try directory.appendingPathComponent(file)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        var resource = URLResourceValues()
        resource.isExcludedFromBackup = true
        var protectedURL = url
        try protectedURL.setResourceValues(resource)
    }

    static func writeError(_ error: Error?) {
        let text = error?.localizedDescription ?? ""
        try? write(Data(text.utf8), to: "last-error.txt")
    }
}
