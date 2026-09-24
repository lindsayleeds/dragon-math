import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

/// The app's way to reach the Dragon Math server.
///
/// `Client`, `Operations` and `Components` are generated at build time from
/// server/openapi.json (symlinked into this target), so a contract change that
/// breaks a caller is a compile error, not a runtime surprise. Build one of
/// these with a base URL and a token provider and call operations on `api`;
/// the transport and auth middleware stay in here.
public struct DragonAPIClient: Sendable {
    /// Returns the bearer token for the next request, or nil when signed out.
    /// Called once per request, so a refreshed token is picked up immediately.
    public typealias TokenProvider = @Sendable () async throws -> String?

    /// Every operation in the contract, one method per `operationId`.
    public let api: any APIProtocol

    /// - Parameters:
    ///   - baseURL: server origin, e.g. `https://example.com`. The contract's
    ///     paths already start with `/api/`, so don't include it.
    ///   - transport: defaults to URLSession; tests pass a stub.
    ///   - tokenProvider: see ``TokenProvider``.
    public init(
        baseURL: URL,
        transport: any ClientTransport = URLSessionTransport(),
        tokenProvider: @escaping TokenProvider
    ) {
        api = Client(
            serverURL: baseURL,
            transport: transport,
            middlewares: [BearerTokenMiddleware(tokenProvider: tokenProvider)]
        )
    }
}

/// Adds `Authorization: Bearer <token>` when the provider has a token. Routes
/// without `security` in the contract simply ignore the header.
struct BearerTokenMiddleware: ClientMiddleware {
    let tokenProvider: DragonAPIClient.TokenProvider

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        if let token = try await tokenProvider() {
            request.headerFields[.authorization] = "Bearer \(token)"
        }
        return try await next(request, body, baseURL)
    }
}
