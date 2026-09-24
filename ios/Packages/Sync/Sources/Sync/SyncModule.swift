// Drains the event queue in idempotent batches (ADR 0003); `SyncEngine` is the
// entry point. Depends on Store and API.
import API
import Store

public enum SyncModule {
    /// The module's name.
    public static let name = "Sync"

    /// The modules Sync sits between.
    public static let dependencies = [StoreModule.name, APIModule.name]
}
