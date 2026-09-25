import Foundation
import GameRules
import Testing
import TextNormalization

/// The parts of golden/memorize.json that depend on normalization.
private struct Golden: Decodable {
    struct Normalize: Decodable {
        let input: String
        let normalized: String
        let firstLetter: String
    }

    struct Passage: Decodable {
        struct Sentence: Decodable {
            let words: [String]
            let firstLetters: [String]
        }

        let name: String
        let body: String
        let unsupported: [String]
        let sentences: [Sentence]
    }

    let normalize: [Normalize]
    let passages: [Passage]

    static func load() throws -> Golden {
        try JSONDecoder().decode(Golden.self, from: RepoPaths.goldenData("memorize"))
    }
}

/// Code point for code point: Swift's `==` on strings treats canonically
/// equivalent strings as equal, which would hide a missing decomposition.
private func scalars(_ s: String) -> [UInt32] { s.unicodeScalars.map(\.value) }

@Test func nfkdMatchesTheGoldenNormalizeTable() throws {
    let rows = try Golden.load().normalize
    #expect(!rows.isEmpty)
    for row in rows {
        #expect(scalars(Memorize.normalizeWord(row.input)) == scalars(row.normalized), "\(row.input)")
        #expect(scalars(Memorize.firstLetter(row.input)) == scalars(row.firstLetter), "\(row.input)")
    }
}

@Test func firstLettersAndUnsupportedWordsMatchGolden() throws {
    for passage in try Golden.load().passages {
        for sentence in passage.sentences {
            #expect(sentence.words.map { scalars(Memorize.firstLetter($0)) } == sentence.firstLetters.map(scalars),
                "\(passage.name)")
        }
        #expect(Memorize.unsupportedWords(passage.body).map(scalars) == passage.unsupported.map(scalars),
            "\(passage.name)")
    }
}

@Test func decomposesCompatibilityCharacters() {
    #expect(scalars(TextNormalization.nfkd("ﬁ")) == scalars("fi"))
    #expect(scalars(TextNormalization.nfkd("é")) == [0x65, 0x301])
}

@Test func practiceRunUsesTheNormalizer() {
    var practice = MemorizePractice(body: "Émile smiled.", difficulty: .hard, rng: SeededRandom(seed: 0))
    #expect(practice.pressLetter("E") == .correct)
    #expect(practice.pressLetter("s") == .correct)
    #expect(practice.isComplete)
}
