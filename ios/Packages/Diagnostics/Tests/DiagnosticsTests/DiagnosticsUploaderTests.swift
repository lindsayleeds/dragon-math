import API
import Foundation
import Testing
@testable import Diagnostics

@Suite struct DiagnosticsUploaderTests {
    let server = FakeDiagnosticsServer()
    let clock = TestClock()
    let directory = temporaryDirectory()

    func uploader(_ queue: DiagnosticsQueue? = nil) -> DiagnosticsUploader {
        let clock = clock
        return DiagnosticsUploader(
            queue: queue ?? DiagnosticsQueue(directory: directory),
            // As the app builds it: no session, so nothing links a report to an account.
            client: DragonAPIClient(baseURL: baseURL, transport: server, tokenProvider: { nil }),
            appVersion: "0.1.0 (1)",
            osVersion: "Version 18.6 (Build 22G86)",
            now: { clock.now })
    }

    func queued() throws -> Int { try DiagnosticsQueue(directory: directory).pending(now: clock.now).count }

    // MARK: - The subscriber's payload handling

    @Test func subscriberUploadsADiagnosticPayloadAsMetricKitWroteIt() async throws {
        let json = try fixture("diagnostic-payload")
        let subscriber = MetricKitSubscriber(uploader: uploader())

        subscriber.receive([json], kind: .diagnostic)

        #expect(await eventually { server.requests.count == 1 })
        let request = try #require(server.requests.first)
        #expect(request.path == "/api/diagnostics/metrickit")
        #expect(request.authorization == nil)
        #expect(request.body["kind"] as? String == "diagnostic")
        #expect(request.body["app_version"] as? String == "0.1.0 (1)")
        #expect(request.body["os_version"] as? String == "Version 18.6 (Build 22G86)")
        #expect(UUID(uuidString: request.id) != nil)
        let sent = try #require(request.body["payload"] as? NSDictionary)
        let original = try #require(try JSONSerialization.jsonObject(with: json) as? NSDictionary)
        #expect(sent == original)
        #expect(await eventually { (try? queued()) == 0 })
    }

    @Test func subscriberUploadsEachMetricPayloadWithItsOwnID() async throws {
        let json = try fixture("metric-payload")
        let subscriber = MetricKitSubscriber(uploader: uploader())

        subscriber.receive([json, json], kind: .metric)

        #expect(await eventually { server.requests.count == 2 })
        #expect(server.requests.allSatisfy { $0.body["kind"] as? String == "metric" })
        #expect(Set(server.requests.map(\.id)).count == 2)
        let launch = try #require(server.requests.first?.body["payload"] as? [String: Any])["applicationLaunchMetrics"]
        #expect(launch != nil)
    }

    @Test func subscriberIgnoresAnEmptyDelivery() async throws {
        let subscriber = MetricKitSubscriber(uploader: uploader())
        subscriber.receive([], kind: .metric)
        try await Task.sleep(for: .milliseconds(20))
        #expect(server.requests.isEmpty)
    }

    // MARK: - Queueing

    @Test func dropsAReportThatIsNotAJSONObject() async throws {
        let uploader = uploader()
        #expect(await uploader.enqueue(Data("not json".utf8), kind: .metric) == false)
        #expect(await uploader.enqueue(Data("[1, 2]".utf8), kind: .metric) == false)
        #expect(try queued() == 0)
        #expect(await uploader.flush() == DiagnosticsUploader.FlushReport())
        #expect(server.requests.isEmpty)
    }

    @Test func neverQueuesAReportTheServerWouldRefuseAsTooLarge() async throws {
        let big = try JSONSerialization.data(withJSONObject: ["blob": String(repeating: "x", count: 300 * 1024)])
        let uploader = uploader()
        #expect(await uploader.enqueue(big, kind: .diagnostic) == false)
        #expect(try queued() == 0)
    }

    @Test func keepsOnlyTheNewestReports() async throws {
        let uploader = uploader(DiagnosticsQueue(directory: directory, maxReports: 3))
        for index in 0..<5 {
            clock.advance(1)
            #expect(await uploader.enqueue(Data(#"{"n": \#(index)}"#.utf8), kind: .metric))
        }
        await uploader.flush()
        #expect(server.requests.compactMap { ($0.body["payload"] as? [String: Any])?["n"] as? Int } == [2, 3, 4])
    }

    @Test func dropsReportsTooOldToBeWorthSending() async throws {
        let uploader = uploader(DiagnosticsQueue(directory: directory, maxAge: 60))
        await uploader.enqueue(Data(#"{"n": 1}"#.utf8), kind: .metric)
        clock.advance(61)
        await uploader.enqueue(Data(#"{"n": 2}"#.utf8), kind: .metric)
        await uploader.flush()
        #expect(server.requests.compactMap { ($0.body["payload"] as? [String: Any])?["n"] as? Int } == [2])
        #expect(try queued() == 0)
    }

    // MARK: - Uploading

    @Test func uploadsOldestFirstAndEmptiesTheQueue() async throws {
        let uploader = uploader()
        for index in 0..<3 {
            clock.advance(1)
            await uploader.enqueue(Data(#"{"n": \#(index)}"#.utf8), kind: .metric)
        }
        let report = await uploader.flush()
        #expect(report.uploaded == 3 && report.remaining == 0)
        #expect(server.requests.compactMap { ($0.body["payload"] as? [String: Any])?["n"] as? Int } == [0, 1, 2])
    }

    @Test(arguments: [400, 413])
    func dropsAReportTheServerRefusesForGood(status: Int) async throws {
        server.script(.status(status))
        let uploader = uploader()
        await uploader.enqueue(Data(#"{"n": 1}"#.utf8), kind: .metric)
        clock.advance(1)
        await uploader.enqueue(Data(#"{"n": 2}"#.utf8), kind: .metric)

        let report = await uploader.flush()
        #expect(report.dropped == 1 && report.uploaded == 1 && report.remaining == 0)
        #expect(server.requests.count == 2)
    }

    @Test(arguments: [FakeDiagnosticsServer.Script.status(429), .status(500), .status(404), .networkDown])
    func keepsReportsForLaterWhenTheServerCantTakeThemNow(script: FakeDiagnosticsServer.Script) async throws {
        server.script(script)
        let uploader = uploader()
        await uploader.enqueue(Data(#"{"n": 1}"#.utf8), kind: .metric)
        clock.advance(1)
        await uploader.enqueue(Data(#"{"n": 2}"#.utf8), kind: .metric)

        let first = await uploader.flush()
        // Stops at the first failure rather than hammering on.
        #expect(first.uploaded == 0 && first.remaining == 2)
        #expect(server.requests.count == 1)

        let second = await uploader.flush()
        #expect(second.uploaded == 2 && second.remaining == 0)
        // The resend carries the same id, which the server stores once.
        #expect(server.requests.map(\.id)[0] == server.requests.map(\.id)[1])
    }

    @Test func aQueuedReportSurvivesARelaunch() async throws {
        server.script(.networkDown)
        await uploader().enqueue(try fixture("metric-payload"), kind: .metric)
        #expect(await uploader().flush().remaining == 1)

        let report = await uploader().flush()
        #expect(report.uploaded == 1)
    }

    @Test func dropsAnUnreadableQueuedFile() async throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let millis = Int64(clock.now.timeIntervalSince1970 * 1000)
        try Data("{".utf8).write(to: directory.appending(path: "\(millis)-\(UUID().uuidString).json"))
        let report = await uploader().flush()
        #expect(report.dropped == 1 && report.remaining == 0)
        #expect(server.requests.isEmpty)
    }

    @Test func appVersionReadsTheBundle() {
        // A test bundle has no CFBundleShortVersionString of its own on macOS;
        // the format is what matters.
        #expect(DiagnosticsUploader.appVersion(of: Bundle(for: BundleToken.self)).hasSuffix(")"))
    }
}

private final class BundleToken {}
