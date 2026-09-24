// Drains the event queue in idempotent batches and pulls content changes
// (ADR 0003). Depends on Store and API.
import API
import Store

public enum SyncModule {
    /// The module's name; a placeholder until the real public interface lands.
    public static let name = "Sync"

    /// The modules Sync sits between.
    public static let dependencies = [StoreModule.name, APIModule.name]
}
