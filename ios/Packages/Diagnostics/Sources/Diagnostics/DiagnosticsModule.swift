// MetricKit reports, queued on the device and uploaded best effort; see
// `DiagnosticsUploader` and `MetricKitSubscriber`. Depends on API.
import API

public enum DiagnosticsModule {
    /// The module's name.
    public static let name = "Diagnostics"

    /// The modules Diagnostics uses.
    public static let dependencies = [APIModule.name]
}
