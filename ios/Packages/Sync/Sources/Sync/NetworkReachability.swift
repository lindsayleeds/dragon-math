import Foundation
import Network

/// Whether the device can reach a network. Sync uploads when it comes back;
/// tests pass a stub.
public protocol NetworkReachability: Sendable {
    /// Whether a usable network path exists now, then again on every change.
    /// The stream ends when the consuming task is cancelled.
    func updates() -> AsyncStream<Bool>
}

/// `NetworkReachability` backed by `NWPathMonitor`: a fresh monitor per
/// stream, cancelled when the stream ends.
public struct NWPathReachability: NetworkReachability {
    public init() {}

    public func updates() -> AsyncStream<Bool> {
        AsyncStream { continuation in
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { path in
                continuation.yield(path.status == .satisfied)
            }
            continuation.onTermination = { _ in monitor.cancel() }
            monitor.start(queue: DispatchQueue(label: "dev.placeholder.dragonacademy.sync.reachability"))
        }
    }
}
