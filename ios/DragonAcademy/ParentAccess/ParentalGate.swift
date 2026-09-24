import Foundation

/// The grown-up challenge in front of the parent view (ADR 0007, 0008).
///
/// A multiplication a young child can't do in their head — a teen number times
/// a single digit — written out in words, so a pre-reader can't even see which
/// numbers are involved, and answered by typing the product rather than picking
/// from choices, so it can't be guessed by tapping. Each wrong answer deals a new
/// question; `maxWrongAnswers` in a row locks the gate and sends the child back.
/// Pure logic: randomness is injected so tests are deterministic.
struct ParentalGate {
    struct Challenge: Equatable {
        let lhs: Int
        let rhs: Int
        var answer: Int { lhs * rhs }

        static let lhsRange = 12...19
        static let rhsRange = 3...9

        static func random(using rng: inout some RandomNumberGenerator) -> Challenge {
            Challenge(
                lhs: Int.random(in: lhsRange, using: &rng),
                rhs: Int.random(in: rhsRange, using: &rng)
            )
        }

        /// "What is thirteen times seven?" in the current language. Number
        /// words come from the locale, the sentence from the String Catalog.
        func question(locale: Locale = .current) -> String {
            let words = NumberFormatter()
            words.numberStyle = .spellOut
            words.locale = locale
            let lhsWords = words.string(from: lhs as NSNumber) ?? String(lhs)
            let rhsWords = words.string(from: rhs as NSNumber) ?? String(rhs)
            return String(localized: "What is \(lhsWords) times \(rhsWords)?",
                          comment: "Parental gate question; both values are numbers written out in words")
        }
    }

    enum Outcome: Equatable {
        /// Nothing was entered; nothing counted.
        case empty
        case passed
        /// Wrong; a new challenge is showing.
        case wrong
        /// Too many wrong answers in a row.
        case lockedOut
    }

    static let maxWrongAnswers = 3

    private(set) var challenge: Challenge
    private(set) var wrongAnswers = 0

    init(using rng: inout some RandomNumberGenerator) {
        challenge = .random(using: &rng)
    }

    var isLockedOut: Bool { wrongAnswers >= Self.maxWrongAnswers }

    /// Checks typed text against the current challenge.
    mutating func submit(
        _ text: String,
        locale: Locale = .current,
        using rng: inout some RandomNumberGenerator
    ) -> Outcome {
        guard !isLockedOut else { return .lockedOut }
        guard let answer = Self.parse(text, locale: locale) else {
            return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .empty : wrong(using: &rng)
        }
        if answer == challenge.answer { return .passed }
        return wrong(using: &rng)
    }

    private mutating func wrong(using rng: inout some RandomNumberGenerator) -> Outcome {
        wrongAnswers += 1
        if isLockedOut { return .lockedOut }
        var next = Challenge.random(using: &rng)
        while next == challenge { next = .random(using: &rng) }
        challenge = next
        return .wrong
    }

    /// Accepts the locale's digits (e.g. Arabic-Indic) as well as ASCII ones.
    static func parse(_ text: String, locale: Locale = .current) -> Int? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let value = Int(trimmed) { return value }
        return try? Int(trimmed, format: .number.locale(locale))
    }
}
