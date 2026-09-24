import Foundation
import Testing
@testable import DragonAcademy

@Test func challengesStayInTheGrownUpRange() {
    var rng = TestRNG(seed: 42)
    for _ in 0..<500 {
        let challenge = ParentalGate.Challenge.random(using: &rng)
        #expect(ParentalGate.Challenge.lhsRange.contains(challenge.lhs))
        #expect(ParentalGate.Challenge.rhsRange.contains(challenge.rhs))
        #expect(challenge.answer >= 36)
    }
}

@Test func theRightAnswerPasses() {
    var rng = TestRNG()
    var gate = ParentalGate(using: &rng)
    #expect(gate.submit(" \(gate.challenge.answer) ", using: &rng) == .passed)
    #expect(gate.wrongAnswers == 0)
}

@Test func aWrongAnswerDealsADifferentQuestion() {
    var rng = TestRNG()
    var gate = ParentalGate(using: &rng)
    let first = gate.challenge
    #expect(gate.submit(String(first.answer + 1), using: &rng) == .wrong)
    #expect(gate.challenge != first)
    #expect(gate.wrongAnswers == 1)
}

@Test func threeWrongAnswersLockTheGate() {
    var rng = TestRNG()
    var gate = ParentalGate(using: &rng)
    #expect(gate.submit("1", using: &rng) == .wrong)
    #expect(gate.submit("seven", using: &rng) == .wrong)
    #expect(gate.submit("2", using: &rng) == .lockedOut)
    #expect(gate.isLockedOut)
    // Even the right answer can't open a locked gate.
    #expect(gate.submit(String(gate.challenge.answer), using: &rng) == .lockedOut)
}

@Test func anEmptyAnswerDoesNotCount() {
    var rng = TestRNG()
    var gate = ParentalGate(using: &rng)
    let challenge = gate.challenge
    #expect(gate.submit("   ", using: &rng) == .empty)
    #expect(gate.wrongAnswers == 0)
    #expect(gate.challenge == challenge)
}

@Test func parsesLocalDigits() {
    #expect(ParentalGate.parse("91") == 91)
    #expect(ParentalGate.parse("٩١", locale: Locale(identifier: "ar")) == 91)
    #expect(ParentalGate.parse("") == nil)
    #expect(ParentalGate.parse("ninety") == nil)
}

@Test func questionSpellsTheNumbersOut() {
    let question = ParentalGate.Challenge(lhs: 13, rhs: 7).question(locale: Locale(identifier: "en_US"))
    #expect(question == "What is thirteen times seven?")
    let hasDigits = question.contains(where: \.isNumber)
    #expect(!hasDigits)
}
