import API
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Store
import Sync

let baseURL = URL(string: "https://dragon.example")!

/// A stand-in for the sync server behind a stub transport: it dedupes by
/// event id like the real one, and each request can be scripted to fail.
final class FakeSyncServer: ClientTransport, @unchecked Sendable {
    /// How the next request is answered.
    enum Script {
        /// Answer normally: applied, or duplicate for an id seen before.
        case normal
        /// No response: the network is down.
        case networkDown
        /// The server applies the batch but the response is lost.
        case responseLost
        /// An HTTP error status with an error body.
        case status(Int)
        /// These event ids come back `failed` (not stored); the rest normally.
        case fail(Set<String>)
        /// These event ids come back `rejected`; the rest normally.
        case reject(Set<String>)
    }

    struct Request {
        let authorization: String?
        let events: [[String: Any]]
        let onMainThread: Bool
        var ids: [String] { events.map { $0["id"] as! String } }
    }

    private let lock = NSLock()
    private var scripts: [Script] = []
    private var _requests: [Request] = []
    private var _received: [String: Int] = [:]
    private var inFlight = 0
    private var _maxInFlight = 0
    /// When set, each request waits here before it's answered.
    var gate: Gate?

    func script(_ scripts: Script...) { lock.withLock { self.scripts += scripts } }
    var requests: [Request] { lock.withLock { _requests } }
    /// Times the server stored each event id; more than 1 would be a bug.
    var received: [String: Int] { lock.withLock { _received } }
    var maxInFlight: Int { lock.withLock { _maxInFlight } }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
        -> (HTTPResponse, HTTPBody?)
    {
        let data = try await Data(collecting: body!, upTo: .max)
        let events = (try JSONSerialization.jsonObject(with: data) as! [String: Any])["events"] as! [[String: Any]]
        let onMain = pthread_main_np() != 0
        let script: Script = lock.withLock {
            _requests.append(Request(
                authorization: request.headerFields[.authorization], events: events, onMainThread: onMain))
            inFlight += 1
            _maxInFlight = max(_maxInFlight, inFlight)
            return scripts.isEmpty ? .normal : scripts.removeFirst()
        }
        defer { lock.withLock { inFlight -= 1 } }
        await gate?.wait()

        switch script {
        case .networkDown:
            throw URLError(.notConnectedToInternet)
        case .status(let code):
            return json(code, #"{"error": "nope"}"#)
        case .responseLost:
            _ = results(for: events, failing: [], rejecting: [])
            throw URLError(.networkConnectionLost)
        case .normal:
            return json(200, results(for: events, failing: [], rejecting: []))
        case .fail(let ids):
            return json(200, results(for: events, failing: ids, rejecting: []))
        case .reject(let ids):
            return json(200, results(for: events, failing: [], rejecting: ids))
        }
    }

    private func results(for events: [[String: Any]], failing: Set<String>, rejecting: Set<String>) -> String {
        let results: [[String: Any]] = lock.withLock {
            events.enumerated().map { index, event in
                let id = event["id"] as! String
                let status: String
                if failing.contains(id) {
                    status = "failed"
                } else if rejecting.contains(id) {
                    status = "rejected"
                } else if _received[id] != nil {
                    status = "duplicate"
                } else {
                    _received[id, default: 0] += 1
                    status = "applied"
                }
                var result: [String: Any] = [
                    "index": index, "id": id, "status": status, "acknowledged": status != "failed",
                ]
                if status == "failed" { result["reason"] = "server_error" }
                if status == "rejected" { result["reason"] = "invalid_payload" }
                return result
            }
        }
        let data = try! JSONSerialization.data(withJSONObject: ["results": results])
        return String(decoding: data, as: UTF8.self)
    }

    private func json(_ status: Int, _ body: String) -> (HTTPResponse, HTTPBody?) {
        var response = HTTPResponse(status: .init(code: status))
        response.headerFields[.contentType] = "application/json; charset=utf-8"
        return (response, HTTPBody(body))
    }
}

/// Holds callers until opened.
final class Gate: @unchecked Sendable {
    private let lock = NSLock()
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        await withCheckedContinuation { continuation in
            let resume = lock.withLock {
                if isOpen { return true }
                waiters.append(continuation)
                return false
            }
            if resume { continuation.resume() }
        }
    }

    func open() {
        let waiting = lock.withLock {
            isOpen = true
            defer { waiters = [] }
            return waiters
        }
        waiting.forEach { $0.resume() }
    }
}

/// Network status the test flips by hand.
final class StubReachability: NetworkReachability, @unchecked Sendable {
    private let lock = NSLock()
    private var continuations: [AsyncStream<Bool>.Continuation] = []
    private var current: Bool

    init(online: Bool) { current = online }

    func updates() -> AsyncStream<Bool> {
        AsyncStream { continuation in
            lock.withLock {
                continuations.append(continuation)
                continuation.yield(current)
            }
        }
    }

    func set(online: Bool) {
        lock.withLock {
            current = online
            continuations.forEach { $0.yield(online) }
        }
    }
}

/// Records every backoff wait instead of waiting.
final class SleepRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var _sleeps: [Duration] = []
    var sleeps: [Duration] { lock.withLock { _sleeps } }
    func sleep(_ duration: Duration) async throws { lock.withLock { _sleeps.append(duration) } }
}

/// A session flag the test can flip.
final class SessionFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var _signedIn: Bool
    init(signedIn: Bool) { _signedIn = signedIn }
    var signedIn: Bool {
        get { lock.withLock { _signedIn } }
        set { lock.withLock { _signedIn = newValue } }
    }
}

/// A Store event kind Sync has no mapping for.
struct Telemetry: EventPayload, Equatable {
    static let kind: EventKind = "test.telemetry"
    let name: String
}

/// Waits (a bounded number of scheduler turns) for `condition`.
func eventually(_ condition: @Sendable () async throws -> Bool) async rethrows -> Bool {
    for _ in 0..<2_000 {
        if try await condition() { return true }
        try? await Task.sleep(for: .milliseconds(1))
    }
    return try await condition()
}
