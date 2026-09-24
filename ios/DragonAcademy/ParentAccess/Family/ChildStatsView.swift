import Store
import SwiftUI

/// One child's stats, pushed from the parent view's "Children" list.
struct ChildStatsView: View {
    let child: Profile
    @Environment(\.store) private var store
    @Environment(\.sync) private var sync
    @Environment(\.childStats) private var service
    @State private var model: ChildStatsModel?

    var body: some View {
        ScrollView {
            if let model {
                ChildStatsContent(model: model)
                    .frame(maxWidth: 480)
                    .padding()
                    .frame(maxWidth: .infinity)
            } else {
                ProgressView().padding()
            }
        }
        .navigationTitle(child.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model?.load() }
        .task {
            if model == nil, let store = store ?? (try? SQLiteStore.inMemory()) {
                model = ChildStatsModel(child: child, store: store, service: service)
            }
            // Send anything this device still has queued, so it counts next time.
            sync?.requestSync()
            await model?.load()
        }
    }
}

private struct ChildStatsContent: View {
    let model: ChildStatsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let message = noticeMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("childStats.notice")
            }
            if let stats = model.stats {
                RecentPlayCard(stats: stats)
                ProgressCard(stats: stats)
                MasteryCard(stats: stats)
                if model.hasUnsyncedPlay {
                    Label(
                        "Some play on this device hasn't synced yet. It will show here once it does.",
                        systemImage: "arrow.triangle.2.circlepath"
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("childStats.unsynced")
                }
            } else if model.isLoading {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
    }

    private var noticeMessage: LocalizedStringKey? {
        switch model.notice {
        case nil: nil
        case .sessionExpired: "Your sign-in has expired. Sign out, then sign in again."
        case .notFound: "This child isn't in your family on Dragon Academy any more."
        case .unavailable:
            model.stats == nil
                ? "Couldn't reach Dragon Academy. Check your connection and try again."
                : "Couldn't refresh. Showing the last stats loaded."
        }
    }
}

private struct StatCard<Content: View>: View {
    let title: LocalizedStringKey
    let identifier: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }
}

private struct Figure: View {
    let value: String
    let label: LocalizedStringKey

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title2.bold().monospacedDigit())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private struct RecentPlayCard: View {
    let stats: ChildStats

    var body: some View {
        StatCard(title: "Recent play", identifier: "childStats.play") {
            HStack {
                Figure(value: minutes(stats.minutesToday), label: "Today")
                Figure(value: minutes(stats.minutesThisWeek), label: "Last 7 days")
            }
            if let last = stats.lastPlayedAt {
                Text("Last played \(last, format: .relative(presentation: .named))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                Text("Hasn't played yet.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func minutes(_ n: Int) -> String {
        Duration.seconds(n * 60).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated))
    }
}

private struct ProgressCard: View {
    let stats: ChildStats

    var body: some View {
        StatCard(title: "Progress", identifier: "childStats.progress") {
            HStack {
                Figure(value: "\(stats.nodesWon)", label: "Battles won")
                Figure(value: "\(stats.stars) / \(stats.nodesWon * 3)", label: "Stars")
            }
            HStack {
                Figure(value: "\(stats.frontierNode)", label: "Furthest node")
                Figure(value: "\(stats.dragonKinds)", label: "Dragons collected")
            }
            if stats.dragonsTotal > stats.dragonKinds {
                Text("\(stats.dragonsTotal) dragons caught, counting repeats.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct MasteryCard: View {
    let stats: ChildStats

    var body: some View {
        StatCard(title: "Math skills", identifier: "childStats.mastery") {
            if stats.operations.isEmpty {
                Text("No problems answered in the last \(stats.masteryWindowDays) days.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                if let strongest = stats.strongest {
                    Label {
                        Text("Strongest: \(OperationName.name(strongest))")
                    } icon: {
                        Image(systemName: "star.fill").foregroundStyle(.yellow)
                    }
                    .accessibilityIdentifier("childStats.strongest")
                }
                if let weakest = stats.weakest {
                    Label {
                        Text("Needs practice: \(OperationName.name(weakest))")
                    } icon: {
                        Image(systemName: "figure.strengthtraining.traditional").foregroundStyle(.orange)
                    }
                    .accessibilityIdentifier("childStats.weakest")
                }
                ForEach(stats.operations, id: \.code) { op in
                    HStack {
                        Text(OperationName.name(op.code))
                        Spacer()
                        Text(op.accuracy, format: .percent.precision(.fractionLength(0)))
                            .monospacedDigit()
                        Text("of \(op.answered)")
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                    .font(.subheadline)
                    .accessibilityElement(children: .combine)
                }
                Text("Solved before the dragon, last \(stats.masteryWindowDays) days.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

enum OperationName {
    static func name(_ code: String) -> String {
        switch code {
        case "add": String(localized: "Addition")
        case "sub": String(localized: "Subtraction")
        case "mul": String(localized: "Multiplication")
        case "div": String(localized: "Division")
        default: code
        }
    }
}

#Preview {
    NavigationStack {
        ChildStatsView(child: Profile(id: UUID(), kind: .child, remoteID: 1, displayName: "Ada", createdAt: .now))
    }
}
