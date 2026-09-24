import CoreGraphics
import SwiftUI
import Testing
@testable import DragonAcademy

/// The battle's layout decisions for the containers the app runs in
/// (IOS_PLAN.md: iPhone portrait; iPad both orientations, Split View, Stage
/// Manager). Sizes are the safe-area content sizes the screen sees.
struct BattleArrangementTests {
    private func arrangement(_ sizeClass: UserInterfaceSizeClass?, _ width: CGFloat, _ height: CGFloat) -> BattleArrangement {
        BattleArrangement.forContainer(horizontalSizeClass: sizeClass, size: CGSize(width: width, height: height))
    }

    @Test func iPhonePortraitIsCompact() {
        #expect(arrangement(.compact, 402, 791) == .compact)  // iPhone 17 Pro
        #expect(arrangement(.compact, 375, 647) == .compact)  // iPhone SE
        #expect(arrangement(.compact, 440, 870) == .compact)  // Pro Max
    }

    @Test func iPadLandscapeIsSideBySide() {
        #expect(arrangement(.regular, 1210, 790) == .sideBySide)  // iPad Pro 11"
        #expect(arrangement(.regular, 1376, 1000) == .sideBySide)  // iPad Pro 13"
        #expect(arrangement(.regular, 1133, 724) == .sideBySide)  // iPad mini
    }

    @Test func iPadPortraitIsStacked() {
        #expect(arrangement(.regular, 834, 1150) == .stacked)
        #expect(arrangement(.regular, 1032, 1330) == .stacked)
    }

    @Test func splitViewAndSlideOverAdaptToTheirWidth() {
        // Half of a landscape iPad: compact width.
        #expect(arrangement(.compact, 601, 790) == .compact)
        // Two thirds of a landscape 13" iPad: regular but not landscape-shaped.
        #expect(arrangement(.regular, 910, 1000) == .stacked)
        // Slide Over.
        #expect(arrangement(.compact, 320, 790) == .compact)
    }

    @Test func stageManagerWindowsFollowTheirShape() {
        #expect(arrangement(.regular, 1000, 700) == .sideBySide)
        #expect(arrangement(.regular, 780, 600) == .stacked)  // too narrow for the panel column
        #expect(arrangement(.regular, 900, 800) == .stacked)  // not landscape-shaped enough
        #expect(arrangement(.regular, 480, 600) == .compact)  // narrow even though regular
    }

    @Test func unknownSizeClassFallsBackToTheWidth() {
        #expect(arrangement(nil, 402, 791) == .compact)
        #expect(arrangement(nil, 1210, 790) == .sideBySide)
        #expect(arrangement(nil, 834, 1150) == .stacked)
    }
}

struct BattleGridMetricsTests {
    @Test func cellsFillTheSpaceUpToTheMaximum() {
        let metrics = BattleGridMetrics(cols: 3, rows: 3, available: CGSize(width: 800, height: 800))
        #expect(metrics.side == BattleGridMetrics.maxSide)
        #expect(metrics.gap == BattleGridMetrics.gap)
    }

    @Test func cellsScaleToTheLimitingSide() {
        // 5 × 5 in a short, wide space: height limits. (400 - 4·8) / 5 = 73.6.
        let metrics = BattleGridMetrics(cols: 5, rows: 5, available: CGSize(width: 900, height: 400))
        #expect(metrics.side == 73)
        #expect(metrics.size(cols: 5, rows: 5).height <= 400)
    }

    @Test func aSevenWideGridFitsTheNarrowestIPhoneAtTheTapMinimum() {
        // 375pt wide less 12pt padding each side.
        let metrics = BattleGridMetrics(cols: 7, rows: 7, available: CGSize(width: 351, height: 800))
        #expect(metrics.side >= 44)
        #expect(metrics.gap == BattleGridMetrics.tightGap)
        #expect(metrics.size(cols: 7, rows: 7).width <= 351)
    }

    @Test func cellsNeverGoBelowTheTapMinimum() {
        let metrics = BattleGridMetrics(cols: 7, rows: 7, available: CGSize(width: 351, height: 200))
        #expect(metrics.side == BattleGridMetrics.minSide)
        #expect(metrics.size(cols: 7, rows: 7).height > 200)  // the grid scrolls
    }

    @Test func noSpaceStillGivesTappableCells() {
        let metrics = BattleGridMetrics(cols: 5, rows: 5, available: .zero)
        #expect(metrics.side == BattleGridMetrics.minSide)
    }
}
