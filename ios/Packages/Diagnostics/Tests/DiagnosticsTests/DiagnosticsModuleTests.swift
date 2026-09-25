import Diagnostics
import Testing

@Test func moduleIsLinked() {
    #expect(DiagnosticsModule.name == "Diagnostics")
    #expect(DiagnosticsModule.dependencies == ["API"])
}
