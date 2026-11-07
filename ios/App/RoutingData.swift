import CryptoKit
import Foundation

// The core resolves rule-set paths against its working directory and refuses files outside it, so the
// bundled China lists are copied to working/routing, where runtimeConfig in mobile/src/profile.ts names them.
enum RoutingData {
    private struct Manifest: Decodable {
        let version: String
        let files: [String: String]
    }

    /// Installs the bundled lists if they differ from the installed copy, and returns the version the tunnel
    /// can use. A failed install keeps the previous copy; nil means no lists are available.
    static func prepare() -> String? {
        guard let target = try? OnedayStore.directory.appendingPathComponent("working/routing") else { return nil }
        do {
            guard let source = Bundle.main.url(forResource: "Routing", withExtension: nil) else {
                throw OnedayError.message("The app bundle has no routing data.")
            }
            let manifest = try Data(contentsOf: source.appendingPathComponent("manifest.json"))
            if (try? Data(contentsOf: target.appendingPathComponent("manifest.json"))) == manifest, let version = try? verifiedVersion(in: target) {
                return version
            }
            // The lists are staged beside the installed copy and swapped in whole, so a reader never sees a mix.
            let staging = target.deletingLastPathComponent().appendingPathComponent("routing.new")
            let files = FileManager.default
            try? files.removeItem(at: staging)
            try files.createDirectory(at: staging, withIntermediateDirectories: true)
            for name in try decode(manifest).files.keys + ["manifest.json"] {
                try files.copyItem(at: source.appendingPathComponent(name), to: staging.appendingPathComponent(name))
            }
            let version = try verifiedVersion(in: staging)
            if files.fileExists(atPath: target.path) {
                _ = try files.replaceItemAt(target, withItemAt: staging)
            } else {
                try files.moveItem(at: staging, to: target)
            }
            return version
        } catch {
            return try? verifiedVersion(in: target)
        }
    }

    private static func decode(_ data: Data) throws -> Manifest {
        try JSONDecoder().decode(Manifest.self, from: data)
    }

    private static func verifiedVersion(in directory: URL) throws -> String {
        let manifest = try decode(Data(contentsOf: directory.appendingPathComponent("manifest.json")))
        for (name, digest) in manifest.files {
            let hash = SHA256.hash(data: try Data(contentsOf: directory.appendingPathComponent(name)))
            guard hash.map({ String(format: "%02x", $0) }).joined() == digest else {
                throw OnedayError.message("Routing data \(name) does not match its manifest.")
            }
        }
        return manifest.version
    }
}
