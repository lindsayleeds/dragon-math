import Foundation
import GameRules
import Testing

/// golden/munchers.json: scripted games through src/rules/munchers.js. Per
/// transcript, one generator (createSeededRandom(seed)) makes the initial state
/// and then every step, in order; each step records the event, the effects and
/// the full state it produced. The events carry their own `now`, so the replay
/// is its own test clock.
///
/// States and effects are compared as JSON: the Swift value is rendered in the
/// JavaScript shape and must equal the recorded object key for key, so a field
/// the port forgot (or invented) fails as surely as a wrong value.
private struct MunchersGolden: Decodable {
    /// The served rule-settings document the defaults come from.
    struct Document: Decodable {
        let schemaVersion: Int
        let munchers: MunchersSettings

        enum CodingKeys: String, CodingKey {
            case schemaVersion = "schema_version"
            case munchers
        }
    }

    struct Step: Decodable {
        let event: JSONValue
        let effects: JSONValue
        let state: JSONValue
    }

    struct Transcript: Decodable, CustomTestStringConvertible {
        let name: String
        let seed: String
        let init_: JSONValue
        let initialState: JSONValue
        let steps: [Step]
        var testDescription: String { name }

        enum CodingKeys: String, CodingKey {
            case name, seed, initialState, steps
            case init_ = "init"
        }
    }

    let fixture: String
    let settings: Document
    let transcripts: [Transcript]

    static func load() throws -> MunchersGolden {
        try JSONDecoder().decode(MunchersGolden.self, from: RepoPaths.goldenData("munchers"))
    }
}

@Test func goldenIsTheMunchersFixture() throws {
    let golden = try MunchersGolden.load()
    #expect(golden.fixture == "munchers")
    #expect(golden.settings.schemaVersion == 1)
    // The served defaults are what the app plays before settings load.
    #expect(golden.settings.munchers == .defaults)
    #expect(golden.transcripts.count >= 10)
    // The slowed and untimed paces each have a transcript.
    let paces = try golden.transcripts.map { try MunchersJSON.pace($0.init_["pace"]) }
    #expect(Set(paces) == Set(GamePace.allCases))
    // Every transcript's settings are the served section but the tuned one.
    let tuned = try golden.transcripts.map { try MunchersJSON.settings($0.init_["settings"]) }.filter { $0 != .defaults }
    #expect(tuned.count == 1)
}

@Test(arguments: try MunchersGolden.load().transcripts)
private func transcriptMatchesGolden(_ t: MunchersGolden.Transcript) throws {
    var rng = SeededRandom(seed: try #require(UInt64(t.seed)))
    let i = t.init_
    var state = MunchersState(
        operation: try MunchersJSON.op(i["operation"]), baseNumber: try i["baseNumber"].int(),
        progression: try i["progression"].bool(), highScore: try i["highScore"].int(),
        settings: try MunchersJSON.settings(i["settings"]), pace: try MunchersJSON.pace(i["pace"]), rng: &rng)
    #expect(MunchersJSON.json(state) == t.initialState, "initial state")

    for (n, step) in t.steps.enumerated() {
        let event = try MunchersJSON.event(step.event)
        let out = stepMunchers(state, event, rng: &rng)
        #expect(MunchersJSON.json(out.effects) == step.effects, "step \(n) \(event) effects")
        let got = MunchersJSON.json(out.state)
        #expect(got == step.state, "step \(n) \(event) state: \(got.diff(step.state))")
        if !out.changed { #expect(out.state == state, "step \(n): unchanged returns the input") }
        state = out.state
        guard got == step.state else { return }
    }
}

@Test func servedSettingsFallBackFieldByField() {
    let d = MunchersSettings.defaults
    let good = MunchersSettings.served(
        startingLives: 5, easyMaxBase: 4, easyPoints: 2, hardPoints: 3, enemyMoveIntervalMs: 2500,
        enemyTelegraphMs: 0, spawnIntervalMs: 3000, caughtBeatMs: 0, chaseChance: 1,
        progressionEasy: [1], progressionHard: [12, 11], enemySpeedupPerLevelMs: 0, minEnemyIntervalMs: 900,
        levelsPerExtraEnemy: 2, maxEnemies: 4)
    #expect(good.startingLives == 5 && good.enemyTelegraphMs == 0 && good.chaseChance == 1)
    #expect(good.progressionHard == [12, 11] && good.maxEnemies == 4)
    let bad = MunchersSettings.served(
        startingLives: 0, easyMaxBase: -1, easyPoints: -1, hardPoints: -1, enemyMoveIntervalMs: 0,
        enemyTelegraphMs: -1, spawnIntervalMs: 0, caughtBeatMs: -1, chaseChance: 1.5,
        progressionEasy: [], progressionHard: [3, 0], enemySpeedupPerLevelMs: -1, minEnemyIntervalMs: 0,
        levelsPerExtraEnemy: 0, maxEnemies: 0)
    #expect(bad == d)
}

@Test func boardDealsEveryAnswerAndOnlyWrongDistractors() {
    var rng = SeededRandom(seed: 9)
    for op in BattleOp.allCases {
        for base in 1...12 {
            let board = Munchers.generateBoard(op, base, rng: &rng)
            let answers = Munchers.correctAnswers(op, base)
            #expect(board.count == Munchers.totalCells)
            // Every answer once; everything else in range and wrong.
            for a in answers { #expect(board.filter { $0 == a }.count == 1, "\(op) \(base): \(a)") }
            for v in board.compactMap({ $0 }) where !answers.contains(v) {
                #expect(v >= 1 && v <= Munchers.maxValue(op, base))
            }
        }
    }
}

@Test func nearestFactNamesTheProblemAnEatenNumberStandsFor() throws {
    let exact = try #require(Munchers.nearestFact(to: 21, operation: .mul, baseNumber: 3))
    #expect(exact == (7, 21))
    // 14 is not a multiple of 3; 15 (3 × 5) is nearest.
    let near = try #require(Munchers.nearestFact(to: 14, operation: .mul, baseNumber: 3))
    #expect(near == (5, 15))
    // A tie takes the smaller factor: 6 is as far from 4 × 1 as from 4 × 2.
    #expect(try #require(Munchers.nearestFact(to: 6, operation: .mul, baseNumber: 4)) == (1, 4))
    #expect(try #require(Munchers.nearestFact(to: 3, operation: .div, baseNumber: 24)) == (7, 3))
    #expect(try #require(Munchers.nearestFact(to: 5, operation: .sub, baseNumber: 9)) == (4, 5))
    #expect(Munchers.nearestFact(to: 1, operation: .sub, baseNumber: 1) == nil)
}

// MARK: - Performance

/// The issue asks for 60 fps on the oldest iOS 18 iPad; no iOS 18 runtime is
/// installable on the build Mac, so this pins the rule's share of a frame
/// instead. A frame is 16.7 ms and a busy frame sends at most a couple of
/// events; the reducer must take a small fraction of that even unoptimized.
@Test func theReducerIsCheapNextToAFrame() throws {
    let golden = try MunchersGolden.load()
    let games = try golden.transcripts.map { t in
        (seed: try #require(UInt64(t.seed)), launch: t.init_, events: try t.steps.map { try MunchersJSON.event($0.event) })
    }
    var steps = 0
    let clock = ContinuousClock()
    let elapsed = try clock.measure {
        for _ in 0..<40 {
            for g in games {
                var rng = SeededRandom(seed: g.seed)
                var state = MunchersState(
                    operation: try MunchersJSON.op(g.launch["operation"]), baseNumber: try g.launch["baseNumber"].int(),
                    progression: try g.launch["progression"].bool(), settings: try MunchersJSON.settings(g.launch["settings"]),
                    pace: try MunchersJSON.pace(g.launch["pace"]), rng: &rng)
                for event in g.events {
                    state = stepMunchers(state, event, rng: &rng).state
                    steps += 1
                }
            }
        }
    }
    let perStepMs = Double(elapsed.components.attoseconds) / 1e15 / Double(steps)
        + Double(elapsed.components.seconds) * 1000 / Double(steps)
    print("munchers reducer: \(steps) steps, \(perStepMs * 1000) µs a step")
    #expect(perStepMs < 1, "\(perStepMs) ms a step")
}

// MARK: - JSON, in the JavaScript shape

/// Any JSON value, compared structurally (object key order doesn't matter).
enum JSONValue: Decodable, Equatable, CustomStringConvertible {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    subscript(key: String) -> JSONValue {
        if case .object(let o) = self { return o[key] ?? .null }
        return .null
    }

    struct Mismatch: Error, CustomStringConvertible {
        let description: String
    }

    func int() throws -> Int {
        guard case .number(let n) = self, n == n.rounded() else { throw Mismatch(description: "not an int: \(self)") }
        return Int(n)
    }

    func double() throws -> Double {
        guard case .number(let n) = self else { throw Mismatch(description: "not a number: \(self)") }
        return n
    }

    func bool() throws -> Bool {
        guard case .bool(let b) = self else { throw Mismatch(description: "not a bool: \(self)") }
        return b
    }

    func string() throws -> String {
        guard case .string(let s) = self else { throw Mismatch(description: "not a string: \(self)") }
        return s
    }

    func array() throws -> [JSONValue] {
        guard case .array(let a) = self else { throw Mismatch(description: "not an array: \(self)") }
        return a
    }

    var description: String {
        switch self {
        case .null: "null"
        case .bool(let b): "\(b)"
        case .number(let n): n == n.rounded() && abs(n) < 1e15 ? "\(Int(n))" : "\(n)"
        case .string(let s): "\"\(s)\""
        case .array(let a): "[\(a.map(\.description).joined(separator: ","))]"
        case .object(let o): "{\(o.keys.sorted().map { "\($0):\(o[$0]!)" }.joined(separator: ","))}"
        }
    }

    /// The top-level keys whose values differ, for a readable failure.
    func diff(_ other: JSONValue) -> String {
        guard case .object(let a) = self, case .object(let b) = other else { return "\(self) vs \(other)" }
        return Set(a.keys).union(b.keys).sorted()
            .filter { a[$0] != b[$0] }
            .map { "\($0): \(a[$0]?.description ?? "missing") vs \(b[$0]?.description ?? "missing")" }
            .joined(separator: "; ")
    }
}

private enum MunchersJSON {
    static func op(_ v: JSONValue) throws -> BattleOp {
        try #require(BattleOp(rawValue: try v.string()))
    }

    /// `init.pace` / `state.pace`: one of the three raw values, exactly.
    static func pace(_ v: JSONValue) throws -> GamePace {
        try #require(GamePace(rawValue: try v.string()))
    }

    /// `init.settings` / `state.settings`: the rule's camelCase field names.
    static func settings(_ v: JSONValue) throws -> MunchersSettings {
        MunchersSettings(
            startingLives: try v["startingLives"].int(), easyMaxBase: try v["easyMaxBase"].int(),
            easyPoints: try v["easyPoints"].int(), hardPoints: try v["hardPoints"].int(),
            enemyMoveIntervalMs: try v["enemyMoveIntervalMs"].double(), enemyTelegraphMs: try v["enemyTelegraphMs"].double(),
            spawnIntervalMs: try v["spawnIntervalMs"].double(), caughtBeatMs: try v["caughtBeatMs"].double(),
            chaseChance: try v["chaseChance"].double(),
            progressionEasy: try v["progressionEasy"].array().map { try $0.int() },
            progressionHard: try v["progressionHard"].array().map { try $0.int() },
            enemySpeedupPerLevelMs: try v["enemySpeedupPerLevelMs"].double(),
            minEnemyIntervalMs: try v["minEnemyIntervalMs"].double(),
            levelsPerExtraEnemy: try v["levelsPerExtraEnemy"].int(), maxEnemies: try v["maxEnemies"].int())
    }

    static func event(_ v: JSONValue) throws -> MunchersEvent {
        let now = try v["now"].double()
        switch try v["type"].string() {
        case "start": return .start(now: now)
        case "tick": return .tick(now: now)
        case "move": return .move(now: now, direction: try #require(MunchersDirection(rawValue: try v["direction"].string())))
        case "eat": return .eat(now: now)
        case "tapCell": return .tapCell(now: now, cell: try v["cell"].int())
        case "dismissWrongAnswer": return .dismissWrongAnswer(now: now)
        case "advanceLevel": return .advanceLevel(now: now)
        case "configChanged":
            return .configChanged(
                now: now, operation: try op(v["operation"]), baseNumber: try v["baseNumber"].int(),
                progression: try v["progression"].bool())
        case let type: throw JSONValue.Mismatch(description: "unknown event \(type)")
        }
    }

    private static func num(_ n: Int) -> JSONValue { .number(Double(n)) }
    private static func num(_ n: Int?) -> JSONValue { n.map(num) ?? .null }
    private static func nums(_ a: [Int]) -> JSONValue { .array(a.map(num)) }

    static func json(_ s: MunchersSettings) -> JSONValue {
        .object([
            "startingLives": num(s.startingLives), "easyMaxBase": num(s.easyMaxBase),
            "easyPoints": num(s.easyPoints), "hardPoints": num(s.hardPoints),
            "enemyMoveIntervalMs": .number(s.enemyMoveIntervalMs), "enemyTelegraphMs": .number(s.enemyTelegraphMs),
            "spawnIntervalMs": .number(s.spawnIntervalMs), "caughtBeatMs": .number(s.caughtBeatMs),
            "chaseChance": .number(s.chaseChance),
            "progressionEasy": nums(s.progressionEasy), "progressionHard": nums(s.progressionHard),
            "enemySpeedupPerLevelMs": .number(s.enemySpeedupPerLevelMs),
            "minEnemyIntervalMs": .number(s.minEnemyIntervalMs),
            "levelsPerExtraEnemy": num(s.levelsPerExtraEnemy), "maxEnemies": num(s.maxEnemies),
        ])
    }

    static func json(_ s: MunchersState) -> JSONValue {
        .object([
            "settings": json(s.settings),
            "pace": .string(s.pace.rawValue),
            "operation": .string(s.operation.rawValue),
            "baseNumber": num(s.baseNumber),
            "progression": .bool(s.progression),
            "levels": nums(s.levels),
            "level": num(s.level),
            "board": .array(s.board.map(num)),
            "eaten": nums(s.eaten),
            "muncher": num(s.muncher),
            "enemies": .array(s.enemies.map {
                .object([
                    "id": num($0.id), "position": num($0.position), "facing": .string($0.facing.rawValue),
                    "nextPosition": num($0.nextPosition),
                ])
            }),
            "nextEnemyId": num(s.nextEnemyId),
            "lives": num(s.lives),
            "score": num(s.score),
            "highScore": num(s.highScore),
            "isNewHighScore": .bool(s.isNewHighScore),
            "correctEaten": num(s.correctEaten),
            "babyDragons": .array(s.babyDragons.map { .object(["id": .string($0.id), "emoji": .string($0.emoji)]) }),
            "wrongAnswer": s.wrongAnswer.map {
                .object([
                    "operation": .string($0.operation.rawValue), "baseNumber": num($0.baseNumber), "value": num($0.value),
                ])
            } ?? .null,
            "started": .bool(s.started),
            "levelTransition": .bool(s.levelTransition),
            "caughtAt": num(s.caughtAt),
            "gameOver": .bool(s.gameOver),
            "timers": .array(s.timers.map {
                .object(["id": num($0.id), "kind": .string($0.kind.rawValue), "at": .number($0.at)])
            }),
            "nextTimerId": num(s.nextTimerId),
        ])
    }

    static func json(_ effects: [MunchersEffect]) -> JSONValue {
        .array(effects.map {
            switch $0 {
            case .sound(let sound): .object(["type": .string("sound"), "sound": .string(sound.rawValue)])
            case .saveHighScore(let score): .object(["type": .string("saveHighScore"), "score": num(score)])
            case .gameOver(let score): .object(["type": .string("gameOver"), "score": num(score)])
            }
        })
    }
}
