import API

/// The signed-in session's bearer token, shared by the API client and Sync.
/// Nil until sign-in (#120, #124) sets it, so for now nothing uploads and the
/// queue simply waits on the device.
actor SessionTokens {
    private var token: String?

    func current() -> String? { token }

    func set(_ token: String?) { self.token = token }

    nonisolated var provider: DragonAPIClient.TokenProvider {
        { [self] in await current() }
    }
}
