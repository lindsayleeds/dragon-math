import GameRules
import SwiftUI
import Testing
@testable import DragonAcademy

struct AccessibilityTextTests {
    @Test func aNodesValueIsItsState() {
        #expect(MapNodeAccessibility.value(.locked) == "locked")
        #expect(MapNodeAccessibility.value(.available) == "not won yet")
        #expect(MapNodeAccessibility.value(.won) == "won")
    }

    @Test func aNodesHintSaysWhatTappingDoes() {
        #expect(MapNodeAccessibility.hint(.locked, isBoss: false, isCurrent: false) == "Win the nodes before it to unlock it.")
        #expect(MapNodeAccessibility.hint(.locked, isBoss: true, isCurrent: false) == "Win the nodes before it to unlock it.")
        #expect(MapNodeAccessibility.hint(.available, isBoss: false, isCurrent: false) == "Starts a battle.")
        #expect(MapNodeAccessibility.hint(.won, isBoss: true, isCurrent: false) == "Starts a boss battle.")
    }

    @Test func theNodeToPlayNextSaysSo() {
        #expect(MapNodeAccessibility.hint(.available, isBoss: false, isCurrent: true) == "Your next quest. Starts a battle.")
        #expect(MapNodeAccessibility.hint(.available, isBoss: true, isCurrent: true) == "Your next quest. Starts a boss battle.")
    }

    @Test func besideThePanelATapOnlySelects() {
        #expect(MapNodeAccessibility.hint(.locked, isBoss: false, isCurrent: false, tapSelects: true) == "Shows it in the panel.")
        #expect(MapNodeAccessibility.hint(.available, isBoss: true, isCurrent: true, tapSelects: true) == "Shows it in the panel.")
    }

    @Test func theQuestCountIsReadAsWords() {
        #expect(QuestCountAccessibility.label(won: 3, total: 41) == "3 of 41 quests won")
        #expect(QuestCountAccessibility.label(won: 0, total: 41) == "0 of 41 quests won")
    }

    @Test func aScoreCardReadsNameScoreAndTarget() {
        #expect(ScoreAccessibility.label(name: "sparky", score: 3, target: 10, paused: false) == "sparky: 3 of 10")
        #expect(ScoreAccessibility.label(name: "fox", score: 7, target: 10, paused: true) == "fox: 7 of 10, paused")
    }

    @Test func starsAreReadAsACount() {
        #expect(StarRatingAccessibility.label(filled: 3, total: 5) == "3 of 5 stars")
        #expect(StarRatingAccessibility.label(filled: 0, total: 5) == "0 of 5 stars")
    }

    @Test func reduceMotionDropsDecorativeAnimation() {
        #expect(MotionSafe.animation(.spring, reduceMotion: false) != nil)
        #expect(MotionSafe.animation(.spring, reduceMotion: true) == nil)
        #expect(MotionSafe.animation(.spring, reduceMotion: true, fallback: .easeOut) == .easeOut)
        #expect(MotionSafe.animation(.spring, reduceMotion: false, fallback: .easeOut) == .spring)
    }
}
