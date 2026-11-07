// Compiles the China routing lists into the mrs rule sets bundled with the iOS app.
// Built against the macOS slice of the pinned SDK so the files match the core that reads them.
import Clash
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("ios-routing-data: \(message)\n".utf8))
    exit(1)
}

guard CommandLine.arguments.count == 2 else { fail("usage: ios-routing-data <directory with cn-domain.txt and cn-ip.txt>") }
let directory = CommandLine.arguments[1]
let setup = ClashSetupOptions()
setup.basePath = directory
setup.workingPath = directory
setup.tempPath = directory
setup.runtimeProfile = "iosPacketTunnel"
var error: NSError?
ClashSetup(setup, &error)
if let error { fail(error.localizedDescription) }

for (name, behavior) in [("cn-domain", "domain"), ("cn-ip", "ipcidr")] {
    let source = "\(directory)/\(name).txt"
    guard let lines = try? String(contentsOfFile: source, encoding: .utf8).split(separator: "\n").count else { fail("cannot read \(source)") }
    let result = ClashCompileRuleProvider(source, behavior, "text", "\(directory)/\(name).mrs", &error)
    if let error { fail(error.localizedDescription) }
    // The compiler skips entries it cannot parse; a shorter result means the list was not what we expected.
    guard let result, result.compiled, result.rules == lines else {
        fail("\(name) compiled \(result?.rules ?? 0) of \(lines) entries \(result?.reason ?? "")")
    }
    print("\(name) \(result.rules)")
}

// Spot checks through the core's own matcher catch a list that parsed but means something else.
let document = """
rule-providers:
  cn-domain: {type: file, behavior: domain, format: mrs, path: cn-domain.mrs}
  cn-ip: {type: file, behavior: ipcidr, format: mrs, path: cn-ip.mrs}
rules:
  - RULE-SET,cn-domain,DIRECT
  - RULE-SET,cn-ip,DIRECT,no-resolve
  - MATCH,REJECT
"""
let expectations = [
    ("{\"host\":\"baidu.com\"}", "DIRECT"),
    ("{\"host\":\"www.qq.com\"}", "DIRECT"),
    ("{\"host\":\"www.google.com\"}", "REJECT"),
    ("{\"ip\":\"114.114.114.114\"}", "DIRECT"),
    ("{\"ip\":\"2400:3200::1\"}", "DIRECT"),
    ("{\"ip\":\"8.8.8.8\"}", "REJECT"),
    ("{\"ip\":\"2001:4860:4860::8888\"}", "REJECT"),
]
for (query, policy) in expectations {
    guard let box = ClashMatchRuleForIOS(document, "", query, &error),
          let data = box.value.data(using: .utf8),
          let match = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        fail("match \(query): \(error?.localizedDescription ?? "no result")")
    }
    guard match["policy"] as? String == policy else { fail("\(query) matched \(box.value), expected \(policy)") }
}
