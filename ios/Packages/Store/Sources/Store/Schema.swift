import GRDB

/// Schema migrations, applied in order and never edited once shipped: change
/// the schema by appending a new migration.
enum Schema {
    static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1") { db in
            try db.create(table: "profiles") { t in
                t.primaryKey("id", .blob)  // UUID
                t.column("kind", .text).notNull()  // Profile.Kind
                t.column("remoteID", .integer).unique()
                t.column("displayName", .text).notNull()
                t.column("createdAt", .integer).notNull()  // ms since 1970
            }
            try db.create(table: "events") { t in
                t.primaryKey("id", .blob)  // UUID, generated on device
                t.column("profileID", .blob).notNull().references("profiles")
                t.column("kind", .text).notNull()  // EventKind
                t.column("payload", .text).notNull()  // JSON
                t.column("occurredAt", .integer).notNull()  // ms since 1970, device clock
                t.column("uploadState", .text).notNull()  // UploadState
            }
            try db.create(index: "events_on_profile_kind", on: "events", columns: ["profileID", "kind"])
            try db.create(index: "events_on_upload_state", on: "events", columns: ["uploadState"])
        }

        // The last synced copy of each server content document (rule settings,
        // node config, the dragon catalog), keyed by its ContentName.
        migrator.registerMigration("v2-content-cache") { db in
            try db.create(table: "content_cache") { t in
                t.primaryKey("name", .text)  // ContentName
                t.column("version", .text).notNull()  // the server's version hash
                t.column("json", .blob).notNull()  // the document, UTF-8 JSON
                t.column("syncedAt", .integer).notNull()  // ms since 1970, device clock
            }
        }

        return migrator
    }
}
