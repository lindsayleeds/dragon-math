// Pure game rules: problem generation, battle timing, rewards, mastery.
// No UI and no I/O — only the Swift standard library. Clocks and random number
// generators are injected (ADR 0005), so every rule is repeatable in tests.
public enum GameRulesModule {
    /// The module's name; a placeholder until the real public interface lands.
    public static let name = "GameRules"
}
