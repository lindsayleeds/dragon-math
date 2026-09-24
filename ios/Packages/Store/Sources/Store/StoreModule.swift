// Local persistence behind a `Store` interface (ADR 0003). GRDB arrives in a
// later ticket; the rest of the app never touches SQLite directly.
public enum StoreModule {
    /// The module's name; a placeholder until the real public interface lands.
    public static let name = "Store"
}
