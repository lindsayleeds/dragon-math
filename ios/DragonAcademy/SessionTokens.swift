import API

/// The signed-in session's bearer token, shared by the API client and Sync.
/// Nil while signed out, so nothing uploads and the queue waits on the device.
/// The app seeds it from the Keychain at launch and parent sign-in/out (#120)
/// updates it; kid sign-in (#124) will too.
actor SessionTokens {
    private var token: String?

    init(token: String? = nil) { self.token = token }

    func current() -> String? { token }

    func set(_ token: String?) { self.token = token }

    nonisolated var provider: DragonAPIClient.TokenProvider {
        { [self] in await current() }
    }
}
