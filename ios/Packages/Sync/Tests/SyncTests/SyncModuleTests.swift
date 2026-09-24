import Testing
import Sync

@Test func moduleIsLinked() {
    #expect(SyncModule.name == "Sync")
    #expect(SyncModule.dependencies == ["Store", "API"])
}
