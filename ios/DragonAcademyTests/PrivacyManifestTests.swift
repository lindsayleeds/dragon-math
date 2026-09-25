import Foundation
import Testing

/// Keeps DragonAcademy/PrivacyInfo.xcprivacy honest two ways: it declares the
/// same collected data as the privacy label draft (docs/IOS_PRIVACY_LABEL.md),
/// and it declares a reason for every required-reason API the app's own Swift
/// code calls. Apple rejects an upload that uses one without a reason, and a
/// manifest that disagrees with the label is a review risk either way.
@Suite struct PrivacyManifestTests {
    /// ios/, from this file's path; the simulator can read the Mac's disk.
    static let iosDirectory = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()

    func manifest() throws -> [String: Any] {
        let url = try #require(Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"),
                               "PrivacyInfo.xcprivacy isn't in the app bundle")
        return try #require(try PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil)
            as? [String: Any])
    }

    struct Collected: Equatable, CustomStringConvertible {
        let type: String
        let linked: Bool
        let tracking: Bool
        let purposes: Set<String>
        var description: String { "\(type) linked=\(linked) tracking=\(tracking) \(purposes.sorted())" }
    }

    @Test func tracksNobody() throws {
        let manifest = try manifest()
        #expect(manifest["NSPrivacyTracking"] as? Bool == false)
        #expect((manifest["NSPrivacyTrackingDomains"] as? [String])?.isEmpty == true)
    }

    @Test func collectedDataMatchesThePrivacyLabelDraft() throws {
        let declared = try #require(try manifest()["NSPrivacyCollectedDataTypes"] as? [[String: Any]]).map {
            Collected(
                type: $0["NSPrivacyCollectedDataType"] as? String ?? "?",
                linked: $0["NSPrivacyCollectedDataTypeLinked"] as? Bool ?? true,
                tracking: $0["NSPrivacyCollectedDataTypeTracking"] as? Bool ?? true,
                purposes: Set($0["NSPrivacyCollectedDataTypePurposes"] as? [String] ?? []))
        }
        let label = try labelRows()
        #expect(!label.isEmpty)
        #expect(declared.sorted { $0.type < $1.type } == label.sorted { $0.type < $1.type })
    }

    @Test func declaresEveryRequiredReasonAPITheAppCalls() throws {
        let declared = Set(try #require(try manifest()["NSPrivacyAccessedAPITypes"] as? [[String: Any]]).compactMap {
            ($0["NSPrivacyAccessedAPITypeReasons"] as? [String])?.isEmpty == false
                ? $0["NSPrivacyAccessedAPIType"] as? String : nil
        })
        let code = try swiftSources().map(\.1)
        let used = Set(Self.requiredReasonSymbols.compactMap { category, symbols in
            symbols.contains { symbol in code.contains { $0.contains(symbol) } } ? category : nil
        })
        #expect(used.subtracting(declared).isEmpty, "Declare a reason in PrivacyInfo.xcprivacy for \(used.subtracting(declared).sorted())")
        // And nothing stale: a category nobody calls any more should go.
        #expect(declared.subtracting(used).isEmpty, "No code uses \(declared.subtracting(used).sorted()) any more")
    }

    /// Apple's required-reason API categories and the Swift spellings that
    /// reach them, as listed in "Describing use of required reason API".
    static let requiredReasonSymbols: [String: [String]] = [
        "NSPrivacyAccessedAPICategoryUserDefaults": ["UserDefaults", "@AppStorage", "NSUserDefaults"],
        "NSPrivacyAccessedAPICategoryFileTimestamp": [
            "creationDate", "modificationDate", "contentModificationDate", "attributesOfItem",
            // Not a bare "stat(": SwiftUI views name helpers that.
            "fileModificationDate", "getattrlist", "fstat(", "lstat(",
        ],
        "NSPrivacyAccessedAPICategorySystemBootTime": ["systemUptime", "mach_absolute_time", "CACurrentMediaTime"],
        "NSPrivacyAccessedAPICategoryDiskSpace": [
            "volumeAvailableCapacity", "volumeTotalCapacity", "systemFreeSize", "systemSize", "statfs",
        ],
        "NSPrivacyAccessedAPICategoryActiveKeyboards": ["activeInputModes"],
    ]

    /// The app's and every local package's non-test Swift, comments dropped.
    func swiftSources() throws -> [(String, String)] {
        var roots = [Self.iosDirectory.appending(path: "DragonAcademy")]
        let packages = Self.iosDirectory.appending(path: "Packages")
        for package in try FileManager.default.contentsOfDirectory(at: packages, includingPropertiesForKeys: nil) {
            roots.append(package.appending(path: "Sources"))
        }
        var files: [(String, String)] = []
        for root in roots {
            guard let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else { continue }
            for case let url as URL in walker where url.pathExtension == "swift" {
                let code = try String(contentsOf: url, encoding: .utf8)
                    .split(separator: "\n", omittingEmptySubsequences: false)
                    .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
                    .joined(separator: "\n")
                files.append((url.lastPathComponent, code))
            }
        }
        #expect(files.contains { $0.0 == "DragonAcademyApp.swift" })
        return files
    }

    /// The label draft's table rows: `| name | `key` | Yes/No | Yes/No | purposes | … |`.
    func labelRows() throws -> [Collected] {
        let doc = Self.iosDirectory.deletingLastPathComponent().appending(path: "docs/IOS_PRIVACY_LABEL.md")
        let purposeKeys = [
            "App Functionality": "NSPrivacyCollectedDataTypePurposeAppFunctionality",
            "Analytics": "NSPrivacyCollectedDataTypePurposeAnalytics",
            "Product Personalization": "NSPrivacyCollectedDataTypePurposeProductPersonalization",
            "Developer's Advertising or Marketing": "NSPrivacyCollectedDataTypePurposeDeveloperAdvertising",
            "Third-Party Advertising": "NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising",
            "Other Purposes": "NSPrivacyCollectedDataTypePurposeOther",
        ]
        return try String(contentsOf: doc, encoding: .utf8).split(separator: "\n").compactMap { line in
            let cells = line.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }
            guard cells.count >= 5, cells[1].hasPrefix("`NSPrivacyCollectedDataType") else { return nil }
            let purposes = try cells[4].split(separator: ",").map {
                try #require(purposeKeys[$0.trimmingCharacters(in: .whitespaces)], "Unknown purpose \($0)")
            }
            return Collected(
                type: cells[1].trimmingCharacters(in: CharacterSet(charactersIn: "`")),
                linked: cells[2] == "Yes", tracking: cells[3] == "Yes", purposes: Set(purposes))
        }
    }
}
