import API
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

let baseURL = URL(string: "https://dragon.example")!

/// The MetricKit JSON fixtures in `Fixtures/` — shaped like
/// `jsonRepresentation()` output. The server's contract test posts the same
/// files (server/routes/diagnostics.contract.test.js).
func fixture(_ name: String) throws -> Data {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
}

/// A fresh, empty directory for one test's queue.
func temporaryDirectory() -> URL {
    FileManager.default.temporaryDirectory.appending(path: "DiagnosticsTests-\(UUID().uuidString)", directoryHint: .isDirectory)
}

/// Stands in for `POST /api/diagnostics/metrickit` behind a stub transport.
final class FakeDiagnosticsServer: ClientTransport, @unchecked Sendable {
    enum Script {
        case status(Int)
        case networkDown
    }

    struct Request {
        let path: String
        let authorization: String?
        let body: [String: Any]
        var id: String { body["id"] as! String }
    }

    private let lock = NSLock()
    private var scripts: [Script] = []
    private var _requests: [Request] = []

    func script(_ scripts: Script...) { lock.withLock { self.scripts += scripts } }
    var requests: [Request] { lock.withLock { _requests } }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
        -> (HTTPResponse, HTTPBody?)
    {
        let data = try await Data(collecting: body!, upTo: .max)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let script: Script = lock.withLock {
            _requests.append(Request(
                path: request.path ?? "", authorization: request.headerFields[.authorization], body: json))
            return scripts.isEmpty ? .status(202) : scripts.removeFirst()
        }
        switch script {
        case .networkDown:
            throw URLError(.notConnectedToInternet)
        case .status(202):
            return respond(202, #"{"accepted": true}"#)
        case .status(let code):
            return respond(code, #"{"error": "nope"}"#)
        }
    }

    private func respond(_ status: Int, _ body: String) -> (HTTPResponse, HTTPBody?) {
        var response = HTTPResponse(status: .init(code: status))
        response.headerFields[.contentType] = "application/json; charset=utf-8"
        return (response, HTTPBody(body))
    }
}

/// A clock the test moves by hand.
final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var _now = Date(timeIntervalSince1970: 1_790_000_000)
    var now: Date { lock.withLock { _now } }
    func advance(_ seconds: TimeInterval) { lock.withLock { _now += seconds } }
}

/// Waits (a bounded number of scheduler turns) for `condition`.
func eventually(_ condition: @Sendable () async throws -> Bool) async rethrows -> Bool {
    for _ in 0..<2_000 {
        if try await condition() { return true }
        try? await Task.sleep(for: .milliseconds(1))
    }
    return try await condition()
}
