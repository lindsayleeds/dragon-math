/// How long Sync waits before trying again after a failed upload: exponential
/// backoff with jitter, so a fleet of devices coming back online together
/// doesn't hit the server in lockstep.
public struct RetryPolicy: Sendable, Equatable {
    /// The wait before the first retry, before jitter.
    public var baseDelay: Duration
    /// The longest wait between tries, before jitter.
    public var maxDelay: Duration
    /// Retries after the first try in one sync run; after that Sync gives up
    /// until the next trigger (a battle ending, the app returning, the network
    /// coming back). Events stay queued either way.
    public var maxRetries: Int

    public init(baseDelay: Duration = .seconds(2), maxDelay: Duration = .seconds(120), maxRetries: Int = 5) {
        self.baseDelay = baseDelay
        self.maxDelay = maxDelay
        self.maxRetries = maxRetries
    }

    /// The wait before retry number `retry` (1 for the first), given `random`
    /// in [0, 1): `min(maxDelay, baseDelay × 2^(retry − 1))`, scaled by a
    /// jitter factor in [0.5, 1) — "equal jitter", so a retry is never
    /// immediate.
    public func delay(beforeRetry retry: Int, random: Double) -> Duration {
        let exponent = min(max(retry - 1, 0), 30)
        let backoff = min(maxDelay, baseDelay * (1 << exponent))
        return backoff * (0.5 + 0.5 * min(max(random, 0), 1))
    }
}
