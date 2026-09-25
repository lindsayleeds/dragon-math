#if canImport(MetricKit)
import Foundation
import MetricKit

/// Receives MetricKit's reports and hands them to a ``DiagnosticsUploader``.
///
/// MetricKit delivers an `MXMetricPayload` about once a day and an
/// `MXDiagnosticPayload` after a crash, hang or resource exception (on the next
/// launch, or at once on iOS 15 and later), on a queue of its own. Each is
/// passed on as its `jsonRepresentation()` — the uploader queues it and returns
/// at once, so nothing here waits on disk or network. Keep one alive for the
/// app's lifetime and call ``start()`` at launch. Payloads are only delivered on
/// a device, never in the simulator.
public final class MetricKitSubscriber: NSObject, MXMetricManagerSubscriber, Sendable {
    private let uploader: DiagnosticsUploader

    public init(uploader: DiagnosticsUploader) {
        self.uploader = uploader
    }

    /// Subscribes to MetricKit; reports it's holding are delivered soon after.
    public func start() { MXMetricManager.shared.add(self) }

    public func stop() { MXMetricManager.shared.remove(self) }

    #if os(iOS)
    public func didReceive(_ payloads: [MXMetricPayload]) {
        receive(payloads.map { $0.jsonRepresentation() }, kind: .metric)
    }
    #endif

    public func didReceive(_ payloads: [MXDiagnosticPayload]) {
        receive(payloads.map { $0.jsonRepresentation() }, kind: .diagnostic)
    }

    /// Where both callbacks land, with the payloads already as JSON; tests
    /// call it with fixture JSON, since MetricKit's payload types can't be
    /// made outside MetricKit.
    func receive(_ reports: [Data], kind: DiagnosticsUploader.Kind) {
        guard !reports.isEmpty else { return }
        uploader.submit(reports, kind: kind)
    }
}
#endif
