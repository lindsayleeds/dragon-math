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

        // What the server has for a child from all of their devices (Sync pulls
        // it after uploading), and which uploaded events it already includes.
        migrator.registerMigration("v3-server-progress") { db in
            try db.alter(table: "events") { t in
                // True once a saved server progress includes this event, so an
                // additive kind (dragons) isn't counted from both.
                t.add(column: "inServerProgress", .boolean).notNull().defaults(to: false)
            }
            try db.create(table: "serverProgress") { t in
                t.primaryKey("profileID", .blob).references("profiles", onDelete: .cascade)
                t.column("currentNodeID", .integer).notNull()
                t.column("playMinutes", .integer).notNull()
                t.column("fetchedAt", .integer).notNull()  // ms since 1970, device clock
            }
            try db.create(table: "serverNodes") { t in
                t.column("profileID", .blob).notNull().references("profiles", onDelete: .cascade)
                t.column("nodeID", .integer).notNull()
                t.column("stars", .integer).notNull()
                t.primaryKey(["profileID", "nodeID"])
            }
            try db.create(table: "serverDragons") { t in
                t.column("profileID", .blob).notNull().references("profiles", onDelete: .cascade)
                t.column("dragonID", .integer).notNull()
                t.column("count", .integer).notNull()
                t.primaryKey(["profileID", "dragonID"])
            }
        }

        // A parent's per-child telemetry setting (server users.telemetry_opt_out),
        // so Sync holds telemetry back even offline.
        migrator.registerMigration("v4-telemetry-opt-out") { db in
            try db.alter(table: "profiles") { t in
                t.add(column: "telemetryOptOut", .boolean).notNull().defaults(to: false)
            }
        }

        // The kid's avatar, for the family picker (#124).
        migrator.registerMigration("v5-profile-avatar") { db in
            try db.alter(table: "profiles") { t in
                t.add(column: "avatar", .text)
            }
        }

        // A parent's per-child game pace (server users.game_pace), so battles
        // and Munchers play at it even offline (#167).
        migrator.registerMigration("v6-game-pace") { db in
            try db.alter(table: "profiles") { t in
                t.add(column: "gamePace", .text).notNull().defaults(to: "normal")
            }
        }

        return migrator
    }
}
